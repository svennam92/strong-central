'use strict';

var WebsocketRouter = require('strong-control-channel/ws-router');
var debug = require('debug')('strong-central:driver:base');
var async = require('async');

function BaseDriver(options) {
  this._baseDir = options.baseDir;
  this._server = options.server;
  this._artifactDir = options.artifactDir;
  this._WebsocketRouter = options.WebsocketRouter || WebsocketRouter;
  this._Container = options.Container;

  debug('Initializing exec control endpoint');
  this._execRouter = new this._WebsocketRouter(
    this._server.getHttpServer(),
    this._server.getBaseApp(),
    'executor-control'
  );
  debug('Initializing supervisor control endpoint');
  this._instRouter = new this._WebsocketRouter(
    this._server.getHttpServer(),
    this._server.getBaseApp(),
    'supervisor-control'
  );

  this._executors = {};
}

/**
 * Recreate channels for existing executors/instances. Updates executor and
 * instance metadata values. (Possibly not needed in initial stages)
 *
 * @param {object} execInfo {id, metadata}
 * @param {array} instanceInfos [{id, metadata}]
 * @param {function} callback fn(err)
 */
function reconnect(execInfo, instanceInfos, callback) {
  debug('reconnect executor: %j', execInfo);
  this.createExecutor(
    execInfo.id, execInfo.token, function(err, executor) {
      if (err) return callback(err);

      async.each(instanceInfos, connectInstance, callback);

      function connectInstance(instInfo, callback) {
        debug('with instance: %j', instInfo);

        if (!instInfo.deploymentId) {
          console.error('Undeployable executor %d instance: %j',
            execInfo.id, instInfo);
          return callback();
        }

        executor.createInstance({
          instanceId: instInfo.id,
          env: instInfo.env,
          deploymentId: instInfo.deploymentId,
          token: instInfo.token,
          startOptions: {}, // FIXME
        }, callback);
      }
    }
  );
}
BaseDriver.prototype.reconnect = reconnect;

/**
 * Create a new executor connection
 *
 * @param {string} execId ID of the new executor
 * @param {string} [token] Authentication token. If null, a new token will be
 * generated.
 * @param {function} callback fn(err, execMetadata)
 */
function createExecutor(execId, token, callback) {
  if (typeof token === 'function') {
    callback = token;
    token = null;
  }

  var executor = this._executors[execId] = new this._Executor({
    server: this._server,
    executorRouter: this._execRouter,
    instanceRouter: this._instRouter,
    executorId: execId,
    token: token,
    Container: this._Container,
  });
  executor.listen(callback);
  return executor;
}
BaseDriver.prototype.createExecutor = createExecutor;

function destroyExecutor(execId, callback) {
  this._executors[execId].close(callback);
  delete this._executors[execId];
}
BaseDriver.prototype.destroyExecutor = destroyExecutor;

/**
 * Shutdown the driver and all its connections. Does not shutdown the executors.
 * @param {function} callback fn(err)
 */
function stop(callback) {
  var self = this;

  async.each(Object.keys(self._executors), function(execId, callback) {
    self._executors[execId].close(callback);
  }, callback);
}
BaseDriver.prototype.stop = stop;

/**
 * @param {object} options
 * @param {string} options.executorId
 * @param {string} options.instanceId
 * @param {object} options.instEnv
 * @param {string} options.token auth token for instance if available. Will be
 * generated if not provided
 * @param {object} options.startOptions
 * @param {function} callback
 */
function createInstance(options, callback) {
  return this._executors[options.executorId].createInstance(options, callback);
}
BaseDriver.prototype.createInstance = createInstance;

function destroyInstance(executorId, instanceId, callback) {
  if (!this._executors[executorId]) return setImmediate(callback);
  this._executors[executorId].destroyInstance(instanceId, callback);
}
BaseDriver.prototype.destroyInstance = destroyInstance;

function onExecutorRequest(executorId, req, callback) {
  this._executors[executorId].onRequest(req, callback);
}
BaseDriver.prototype.onExecutorRequest = onExecutorRequest;

function updateInstanceEnv(executorId, instanceId, env, callback) {
  var container = this._containerFor(executorId, instanceId);
  if (!container) return setImmediate(callback);

  container.setEnv(env, callback);
}
BaseDriver.prototype.updateInstanceEnv = updateInstanceEnv;

function setInstanceOptions(executorId, instanceId, options, callback) {
  var container = this._containerFor(executorId, instanceId);
  if (!container) return setImmediate(callback);

  container.setStartOptions(options, callback);
}
BaseDriver.prototype.setInstanceOptions = setInstanceOptions;

function _containerFor(executorId, instanceId) {
  if (!this._executors[executorId]) return null;
  return this._executors[executorId].containerFor(instanceId);
}
BaseDriver.prototype._containerFor = _containerFor;

function instanceRequest(executorId, instanceId, req, callback) {
  this._executors[executorId].instanceRequest(instanceId, req, callback);
}
BaseDriver.prototype.instanceRequest = instanceRequest;

function prepareDriverArtifact(commit, callback) {
  debug('preparing commit not supported');
  setImmediate(callback);
}
BaseDriver.prototype.prepareDriverArtifact = prepareDriverArtifact;

function deploy(executorId, instanceId, deploymentId, callback) {
  debug('deploy commit not supported');
  setImmediate(callback);
}
BaseDriver.prototype.deploy = deploy;

function getDriverArtifact(instanceId, artifactId, req, res) {
  debug('get driver artifact not supported');
  res.status(404).end();
}
BaseDriver.prototype.getDriverArtifact = getDriverArtifact;

module.exports = BaseDriver;
