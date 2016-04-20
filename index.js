var util = require('util')
var path = require('path')

var async = require('async')
var portfinder = require('portfinder')
var mongodb_prebuilt = require('mongodb-prebuilt');
var mongodb = require('mongodb')
var uid = require('uid')
var fs = require('fs')
var rmrf = require('rimraf')
var debug = require('debug')('mockgo')

var dbpath = path.join(__dirname, '.data-' + uid())
var dir = fs.mkdirSync(dbpath)

var connectionCache = {}
var serverConfig = null
var serverEmitter = null

const startServer = (callback) => {
    portfinder.getPort((error, port) => {
        if (error) {
            return callback(error)
        }

        var config = {
            host: '127.0.0.1',
            port: port,
            dbpath: dbpath
        }

        debug('startServer on port %d with data folder %s', port, dbpath)
        serverEmitter = mongodb_prebuilt.start_server({
            args: {
                storageEngine: 'ephemeralForTest',
                bind_ip: config.host,
                port: config.port,
                dbpath: config.dbpath
            },
            auto_shutdown: true
        }, error => callback(error, config))
    })
}

const createConnection = (config, callback) => {
    var uri = util.format('mongodb://%s:%d/%s',
        config.host,
        config.port,
        config.database
    )

    //we add the possibilty to override the version of the mongodb driver
    //by exposing it via module.exports
    module.exports.mongodb.connect(uri, callback)
}

const createServerSpecificConfiguration = (serverConfig, dbName, callback) => {
    debug('creating connection for db "%s"', dbName)

    var configCopy = Object.assign({}, serverConfig)
    configCopy.database = dbName
    createConnection(configCopy, (error, connection) => {
        if (error) callback(error)

        connectionCache[dbName] = connection
        callback(null, connection)
    })
}

const getConnection = (dbName, callback) => {
    if (typeof dbName === 'function') {
        callback = dbName
        dbName = 'testDatabase'
    }

    var connection = connectionCache[dbName]
    if (connection) {
        debug('retrieve connection from connection cache for db "%s"', dbName)
        return process.nextTick(() => callback(null, connection))
    }

    if (serverConfig) {
        return createServerSpecificConfiguration(serverConfig, dbName, callback)
    }

    startServer((error, resultConfiguration) => {
        if (error) return callback(error)

        serverConfig = resultConfiguration
        createServerSpecificConfiguration(serverConfig, dbName, callback)
    })
}

const shutDown = callback => {
    if (serverEmitter) {
        debug('emit shutdown event')
        serverEmitter.emit('mongoShutdown')
    }

    serverEmitter = null
    serverConfig = null
    connectionCache = {}

    var cons = Object.keys(connectionCache).map(key => connectionCache[key])

    if (cons.length > 0) {
        debug('closing %d mongo connections', cons.length)
        async.each(cons, (con, cb) => con.close(cb), callback)
    } else {
        process.nextTick(() => callback(null))
    }
}

module.exports = {
    getConnection,
    shutDown,
    mongodb: mongodb
}

process.on('exit', () => {
    rmrf.sync(dbpath)
})
