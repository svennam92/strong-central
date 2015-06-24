'use strict';

var EventEmitter = require('events').EventEmitter;
var ExecutorDriver = require('./drivers/executor');
var MeshServer = require('strong-mesh-models').meshServer;
var MinkeLite = require('minkelite');
var ServiceManager = require('./service-manager');
var async = require('async');
var debug = require('debug')('strong-central:server');
var express = require('express');
var expressWs = require('express-ws');
var fs = require('fs');
var http = require('http');
var mandatory = require('./util').mandatory;
var path = require('path');
var util = require('util');
var versionApi = require('strong-mesh-models/package.json').version;
var versionCentral = require('../package.json').version;

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
};

function Server(options) {
  options = extend(OPTIONS, options);
  var MeshServer = mandatory(options.MeshServer);
  var ServiceManager = mandatory(options.ServiceManager);

  this._cmdName = options.cmdName || 'sl-central';
  this._baseDir = path.resolve(options.baseDir || '.strong-central');
  this._listenPort = 'listenPort' in options ? options.listenPort : 8701;
  this._httpServer = null;
  var envPath = path.resolve(this._baseDir, 'env.json');

  try {
    this._defaultEnv = JSON.parse(fs.readFileSync(envPath));
  } catch (e) {
    this._defaultEnv = {};
  }

  var meshOptions = {
    auth: process.env.STRONGLOOP_PM_HTTP_AUTH
  };
  /* eslint-disable camelcase */
  // Instantiate minkelite so trace data can be stored
  this._minkelite = new MinkeLite({
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
  });
  /* eslint-enable camelcase */

  if (!process.env.STRONGLOOP_MESH_DB) {
    process.env.STRONGLOOP_MESH_DB =
      'memory://' + path.join(this._baseDir, 'strong-central.json');
  }
  debug('Using STRONGLOOP_MESH_DB=%s', process.env.STRONGLOOP_MESH_DB);

  // The express app on which the rest of the middleware is mounted.
  this._baseApp = express();
  this._serviceManager = new ServiceManager(this);
  this._meshApp = MeshServer(
    this._serviceManager, this._minkelite, meshOptions);
  this._baseApp.use('/artifacts/*', this._retrieveDriverArtifact.bind(this));
  this._baseApp.use(this._meshApp);
}

util.inherits(Server, EventEmitter);

function getBaseDir() {
  return this._baseDir;
}
Server.prototype.getBaseDir = getBaseDir;

function getDefaultEnv() {
  return extend(this._defaultEnv);
}
Server.prototype.getDefaultEnv = getDefaultEnv;

function start(cb) {
  debug('start');

  if (typeof cb !== 'function') {
    cb = function() {};
  }

  var self = this;

  async.series([
    appListen,
    initDriver,
    initEnv,
    reconnectExecutors,
    emitListeningSignal,
  ], done);

  function appListen(callback) {
    debug('Initializing http listen on port %d', self._listenPort);
    try {
      var server = http.createServer(self._baseApp);
      expressWs(self._baseApp, server);

      server.listen(self._listenPort, function(err) {
        if (err) return callback(err);

        var address = this.address();
        console.log(
          '%s: StrongLoop Central v%s (API v%s) listening on port `%s`',
          self._cmdName,
          versionCentral,
          versionApi,
          address.port
        );

        // The HTTP server. This is used when stopping PM and to get the address
        // that PM is listening on
        self._httpServer = this;
        return callback();
      });
    } catch (err) {
      callback(err);
    }
  }

  function initEnv(callback) {
    self._serviceManager.initEnv(self._meshApp, callback);
  }

  function initDriver(callback) {
    var artifactDir = path.resolve(
      self._baseDir, 'artifacts'
    );

    self._driver = new ExecutorDriver({
      artifactDir: artifactDir,
      baseDir: self._baseDir,
      console: console,
      server: self,
    });
    callback();
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

  function emitListeningSignal(serialCb) {
    debug('emitting listening event');
    self.emit('listening', self._httpServer.address());
    process.nextTick(serialCb);
  }

  function done(err) {
    if (!err) return;

    console.error('Listening failed with: %s', err.message);
    self.stop();
    self.emit('error', err);
    cb(err);
  }
}
Server.prototype.start = start;

function stop(cb) {
  debug('stop');
  var shutdownTasks = [];
  var self = this;

  shutdownTasks.push(this._minkelite.shutdown.bind(this._minkelite));

  if (this._ipcControl) {
    shutdownTasks.push(function(next) {
      self._ipcControl.close(next);
      self._ipcControl = null;
    });
  }

  if (this._driver) {
    shutdownTasks.push(this._driver.stop.bind(this._driver));
  }

  shutdownTasks.push(function(next) {
    if (self._httpServer)
      return self._httpServer.close(next);
    next();
  });

  async.series(shutdownTasks, cb);
}
Server.prototype.stop = stop;

function getBaseApp() {
  return this._baseApp;
}
Server.prototype.getBaseApp = getBaseApp;

function updateExecutorData(id, hostname, ip, capacity, metadata, callback) {
  this._serviceManager.updateExecutorData(
    id, hostname, ip, capacity, metadata, callback
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

function port() {
  return this._httpServer.address().port;
}
Server.prototype.port = port;

function updateInstanceEnv(executorId, instanceId, env, callback) {
  this._driver.updateInstanceEnv(executorId, instanceId, env, callback);
}
Server.prototype.updateInstanceEnv = updateInstanceEnv;

function createInstance(executorId, instanceId, env, deploymentId, callback) {
  this._driver.createInstance(
    executorId, instanceId, env, deploymentId, callback
  );
}
Server.prototype.createInstance = createInstance;

function setInstanceOptions(executorId, instanceId, options, callback) {
  this._driver.setInstanceOptions(executorId, instanceId, options, callback);
}
Server.prototype.setInstanceOptions = setInstanceOptions;

function onInstanceNotification(instanceId, msg, callback) {
  this._meshApp.handleModelUpdate(instanceId, msg, callback);
}
Server.prototype.onInstanceNotification = onInstanceNotification;

function setInstanceMetadata(instanceId, data, callback) {
  this._serviceManager.setInstanceMetadata(instanceId, data, callback);
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
    return res.status(404).send('Invalid path').end();
  }

  this._driver.getDriverArtifact(instanceId, artifactId, req, res);
}
Server.prototype._retrieveDriverArtifact = _retrieveDriverArtifact;

module.exports = Server;
