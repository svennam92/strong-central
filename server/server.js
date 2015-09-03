'use strict';

var EventEmitter = require('events').EventEmitter;
var GatewayDriver = require('./gateway');
var MeshServer = require('strong-mesh-models').meshServer;
var MinkeLite = require('minkelite');
var ServiceManager = require('./service-manager');
var SQLite3 = require('loopback-connector-sqlite3');
var async = require('async');
var debug = require('debug')('strong-central:server');
var express = require('express');
var fmt = require('util').format;
var fs = require('fs');
var http = require('http');
var mandatory = require('./util').mandatory;
var path = require('path');
var util = require('util');

// Extend base without modifying it.
function extend(base, extra) {
  return util._extend(util._extend({}, base), extra);
}

// Server option defaults.
var OPTIONS = {
  // The injectable dependencies have defaults, but can be customized for unit
  // testing, or to provide alternative implementations (Driver).
  MeshServer: MeshServer,
  ServiceManager: ServiceManager,
  ExecutorDriver: require('./drivers/executor'),
  driverOptions: {},

  // Optional:
  //   baseDir:       Defaults to '.strong-central'
  //   cmdName:       Defaults to 'sl-central'
  //   listenPort:    Defaults to 8701
  //   trace.debugServerPort Minkelite debug server port. Default 8103.
  //   trace.inMemory Persist data in memory rather than on disk. Default false
  //   trace.db.name  DB file name when persisting to disk. Default minkelite.db
  //   trace.data.chartMinutes    Number of minutes of data points shown on the
  //                              Timeline view. Default 1440.
  //   trace.data.staleMinutes    How long (in minutes) to retain data in the
  //                              db. Default 1450.
  //   trace.data.maxTransaction  Number of transactions returned by the
  //                              getTransation API (JS or HTTP). Default 30.
  //   mesh.db.driver    Database driver name (sqlite3 (default) or memory).
  //   mesh.db.filePath  File path where DB will be persisted on disk.
  //                     Default ${baseDir}/strong-mesh.db
};

function Server(options) {
  options = extend(OPTIONS, options);
  var MeshServer = mandatory(options.MeshServer);
  var ServiceManager = mandatory(options.ServiceManager);

  this._cmdName = options.cmdName || 'sl-central';
  this._baseDir = path.resolve(options.baseDir || '.strong-central');
  this._listenPort = 'listenPort' in options ? options.listenPort : 8701;
  var envPath = path.resolve(this._baseDir, 'env.json');

  var dbDriver = options['mesh.db.driver'] || 'sqlite3';
  this._dataSourceConfig = null;
  switch (dbDriver) {
    case 'sqlite3':
      this._dataSourceConfig = {
        connector: SQLite3,
        file: options['mesh.db.filePath'] ||
          path.join(this._baseDir, 'strong-mesh.db'),
      };
      break;
    case 'memory':
      this._dataSourceConfig = {
        connector: 'memory',
        file: options['mesh.db.filePath'] ||
          path.join(this._baseDir, 'strong-mesh.json'),
      };
      break;
    default:
      throw Error(fmt('data source %s not supported.', dbDriver));
  }

  try {
    this._defaultEnv = JSON.parse(fs.readFileSync(envPath));
  } catch (e) {
    this._defaultEnv = {};
  }

  this._ExecutorDriver = options.ExecutorDriver;
  this._executorDriverConfig = options.driverConfig;

  var meshOptions = {
    db: this._dataSourceConfig,
  };

  // basic auth should not be used with cloud drivers
  if (process.env.STRONGLOOP_PM_HTTP_AUTH) {
    if (this._ExecutorDriver.SUPPORTS_BASIC_AUTH) {
      meshOptions.auth = process.env.STRONGLOOP_PM_HTTP_AUTH;
    } else {
      console.error('Basic auth credentials were specified but %s ' +
        'driver does not support it.', this._ExecutorDriver.NAME);
    }
  }

  this._traceOptions = {
    start_server: !!process.env.STRONGLOOP_DEBUG_MINKELITE,
    server_port: options['trace.debugServerPort'] || 8103,

    in_memory: !!options['trace.db.inMemory'],
    db_name: options['trace.db.name'] || 'minkelite.db',
    db_path: this._baseDir,

    // data points shown on the Timeline view
    chart_minutes: parseInt(options['trace.data.chartMinutes'], 10) ||
    1440, // how long we retain data in the db
    stale_minutes: parseInt(options['trace.data.staleMinutes'], 10) || 1450,
    max_transaction_count: parseInt(options['trace.data.maxTransaction'],
      10) || 30,
  };

  // The express app on which the rest of the middleware is mounted.
  this._baseApp = express();
  this._serviceManager = new ServiceManager(this);
  this._meshApp = MeshServer(
    this._serviceManager, this._minkelite, meshOptions);
  this._baseApp.use('/artifacts/*', this._retrieveDriverArtifact.bind(this));
  this._baseApp.use(this._meshApp);
}

util.inherits(Server, EventEmitter);

function driverName() {
  return this._ExecutorDriver.NAME;
}
Server.prototype.driverName = driverName;

function shouldScheduleSvcs() {
  return this._ExecutorDriver.REQUIRES_SCHEDULER;
}
Server.prototype.shouldScheduleSvcs = shouldScheduleSvcs;

function getBaseDir() {
  return this._baseDir;
}
Server.prototype.getBaseDir = getBaseDir;

function getDefaultEnv() {
  return extend(this._defaultEnv);
}
Server.prototype.getDefaultEnv = getDefaultEnv;

function start(cb) {
  debug('starting server');

  if (typeof cb !== 'function') {
    cb = function() {};
  }

  var self = this;
  this._httpServer = http.createServer(this._baseApp);

  async.series([
    initTracing,
    appListen,
    initDriver,
    initGatewayDriver,
    initDatasource,
    initEnv,
    reconnectExecutors,
    reconnectGateways,
    emitListeningSignal,
  ], done);

  function initDatasource(callback) {
    debug('updating database');
    self._meshApp.dataSources.db.autoupdate(callback);
  }

  function initTracing(callback) {
    /* eslint-disable camelcase */
    // Instantiate minkelite so trace data can be stored
    self._minkelite = new MinkeLite(self._traceOptions);
    /* eslint-enable camelcase */
    self._minkelite.on('error', function(err) {
      if (callback) callback(err);
      callback = null;
    });

    self._minkelite.on('ready', function() {
      if (callback) callback();
      callback = null;
    });
  }

  function appListen(callback) {
    debug('Initializing http listen on port %d', self._listenPort);
    try {
      self._httpServer.listen(self._listenPort, callback);
    } catch (err) {
      callback(err);
    }
  }

  function initEnv(callback) {
    debug('loading initial environment');
    self._serviceManager.initEnv(self._meshApp, callback);
  }

  function initDriver(callback) {
    var artifactDir = path.resolve(
      self._baseDir, 'artifacts'
    );

    self._driver = new self._ExecutorDriver({
      artifactDir: artifactDir,
      baseDir: self._baseDir,
      console: console,
      server: self,
      config: self._executorDriverConfig,
    });

    self._driver.init(callback);
  }

  function initGatewayDriver(callback) {
    self._gwDriver = new GatewayDriver({
      server: self,
    });
    self._gwDriver.init(callback);
  }

  function reconnectExecutors(callback) {
    debug('locating existing executors');
    self._serviceManager.getExecutorInfo(function(err, execInfos) {
      if (err) return callback(err);

      async.eachSeries(execInfos, function(exec, callback) {
        self._serviceManager.getInstanceInfo(exec.id, function(err, instInfos) {
          if (err) return callback(err);

          self._driver.reconnect(exec, instInfos, callback);
        });
      }, callback);
    });
  }

  function reconnectGateways(callback) {
    debug('locating existing gateways');
    self._serviceManager.getGatewayInfos(function(err, gwInfos) {
      if (err) return callback(err);

      async.eachSeries(gwInfos, function(gw, callback) {
        self._gwDriver.createGateway(gw.id, gw.token, callback);
      }, callback);
    });
  }

  function emitListeningSignal(serialCb) {
    debug('emitting listening event');
    self.emit('listening', self._httpServer.address());
    process.nextTick(serialCb);
  }

  function done(err) {
    debug('startup complete');
    if (!err) {
      self._meshApp.set('url',
        fmt('http://:%s', self._httpServer.address().port)
      );
      self._meshApp.emit('started');
      return;
    }

    console.error('Startup failed with: %s', err.message);
    self.stop();
    // XXX(sam) It's weird to callback AND emit an error, also, maybe
    // cb should happen after stop?
    self.emit('error', err);
    cb(err);
  }
}
Server.prototype.start = start;

function stop(cb) {
  var shutdownTasks = [];

  debug('stop');

  if (this._minkelite) {
    shutdownTasks.push(this._minkelite.shutdown.bind(this._minkelite));
  }

  if (this._driver) {
    shutdownTasks.push(this._driver.stop.bind(this._driver));
  }

  if (this._gwDriver) {
    shutdownTasks.push(this._gwDriver.stop.bind(this._gwDriver));
  }

  if (this._httpServer) {
    shutdownTasks.push(this._httpServer.close.bind(this._httpServer));
  }

  async.series(shutdownTasks, cb);
}
Server.prototype.stop = stop;

function getHttpServer() {
  return this._httpServer;
}
Server.prototype.getHttpServer = getHttpServer;

function getBaseApp() {
  return this._baseApp;
}
Server.prototype.getBaseApp = getBaseApp;

function getMeshApp() {
  return this._meshApp;
}

Server.prototype.getMeshApp = getMeshApp;
function updateExecutorData(id, hostname, addr, capacity, metadata, callback) {
  debug('updateExecutorData: id %j hostname %j addr %j capacity %j meta %j',
        id, hostname, addr, capacity, metadata);

  this._serviceManager.updateExecutorData(
    id, hostname, addr, capacity, metadata, callback
  );
}
Server.prototype.updateExecutorData = updateExecutorData;

function updateInstanceMetadata(id, metadata, callback) {
  this._serviceManager.updateInstanceMetadata(id, metadata, callback);
}
Server.prototype.updateInstanceMetadata = updateInstanceMetadata;

function createExecutor(executorId, callback) {
  this._driver.createExecutor(executorId, callback);
}
Server.prototype.createExecutor = createExecutor;

function destroyExecutor(executorId, callback) {
  this._driver.destroyExecutor(executorId, callback);
}
Server.prototype.destroyExecutor = destroyExecutor;

function port() {
  return this._httpServer.address().port;
}
Server.prototype.port = port;

function updateInstanceEnv(executorId, instanceId, env, callback) {
  this._driver.updateInstanceEnv(executorId, instanceId, env, callback);
}
Server.prototype.updateInstanceEnv = updateInstanceEnv;

function onExecutorRequest(executorId, req, callback) {
  this._driver.onExecutorRequest(executorId, req, callback);
}
Server.prototype.onExecutorRequest = onExecutorRequest;

function createInstance(options, callback) {
  this._driver.createInstance(options, callback);
}
Server.prototype.createInstance = createInstance;

function destroyInstance(executorId, instanceId, callback) {
  this._driver.destroyInstance(executorId, instanceId, callback);
}
Server.prototype.destroyInstance = destroyInstance;

function setInstanceOptions(executorId, instanceId, options, callback) {
  this._driver.setInstanceOptions(executorId, instanceId, options, callback);
}
Server.prototype.setInstanceOptions = setInstanceOptions;

function onInstanceNotification(instanceId, msg, callback) {
  this._meshApp.handleModelUpdate(instanceId, msg, callback);
}
Server.prototype.onInstanceNotification = onInstanceNotification;

function setInstanceMetadata(instanceId, metadata, callback) {
  this._serviceManager.setInstanceMetadata(instanceId, metadata, callback);
}
Server.prototype.setInstanceMetadata = setInstanceMetadata;

function prepareDriverArtifacts(commit, callback) {
  this._driver.prepareDriverArtifact(commit, callback);
}
Server.prototype.prepareDriverArtifacts = prepareDriverArtifacts;

function deploy(executorId, instanceId, commitId, callback) {
  this._driver.deploy(executorId, instanceId, commitId, callback);
}
Server.prototype.deploy = deploy;

function _retrieveDriverArtifact(req, res) {
  var reqPath = req.baseUrl.split('/');

  debug('retrieveDriverArtifact: url %s', req.baseUrl);

  // Skip all path elements till /../../artifacts/
  do {
    var pathElement = reqPath.shift();
    if (pathElement === undefined) {
      debug('Invalid path: %s', req.baseUrl);
      return res.status(404).send('Not found').end();
    }
  } while (pathElement !== 'artifacts');

  var driver = reqPath.shift();
  var instanceId = reqPath.shift();
  var artifactId = reqPath.shift();

  if (driver !== 'executor') {
    debug('driver is not executor: %s', driver);
    return res.status(404).send('Invalid path').end();
  }

  this._driver.getDriverArtifact(instanceId, artifactId, req, res);
}
Server.prototype._retrieveDriverArtifact = _retrieveDriverArtifact;

function instanceRequest(executorId, instanceId, req, callback) {
  this._driver.instanceRequest(executorId, instanceId, req, callback);
}
Server.prototype.instanceRequest = instanceRequest;

function markOldProcessesStopped(instanceId, callback) {
  this._serviceManager.markOldProcessesStopped(instanceId, callback);
}
Server.prototype.markOldProcessesStopped = markOldProcessesStopped;

function createGateway(gatewayId, callback) {
  this._gwDriver.createGateway(gatewayId, callback);
}
Server.prototype.createGateway = createGateway;

function destroyGateway(gatewayId, callback) {
  this._gwDriver.destroyGateway(gatewayId, callback);
}
Server.prototype.destroyGateway = destroyGateway;

function onGatewayConnect(gatewayId, callback) {
  this._serviceManager.onGatewayConnect(gatewayId, callback);
}
Server.prototype.onGatewayConnect = onGatewayConnect;

/**
 * Perform a full sync with a gateway. This will erase all endpoints on the
 * gateway and create new ones.
 * @param  {String}      gatewayId        ID of gateway to update
 * @param  {object}      serviceEndpoints Array of services and endpoints
 * @param  {Function}    callback         Callback function
 */
function updateGateway(gatewayId, serviceEndpoints, callback) {
  this._gwDriver.updateGateway(gatewayId, serviceEndpoints, callback);
}
Server.prototype.updateGateway = updateGateway;

/**
 * Update all gateways with endpoint information about one service.
 * @param  {object}      serviceEndpoints Service endpoints
 * @param  {Function}    callback         Callback function
 */
function updateGateways(serviceEndpoints, callback) {
  this._gwDriver.updateGateways(serviceEndpoints, callback);
}
Server.prototype.updateGateways = updateGateways;

module.exports = Server;
