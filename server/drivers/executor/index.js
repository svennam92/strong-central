var Executor = require('./executor');
var WebsocketRouter = require('strong-control-channel/ws-router');
var async = require('async');

function ExecutorDriver(options) {
  this._baseDir = options.baseDir;
  this._console = options.console;
  this._server = options.server;

  this._router = new WebsocketRouter(
    this._server.getBaseApp(),
    'executor-control'
  );
  this._instRouter = new WebsocketRouter(
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
  this.createExecutor(
    execInfo.id, execInfo.token, function(err, executor) {
      if (err) return callback(err);

      async.each(instanceInfos, connectInstance, callback);
      function connectInstance(instInfo, callback) {
        executor.createInstance(
          instInfo.id, instInfo.env, instInfo.token, callback
        );
      }
    }
  );
}
ExecutorDriver.prototype.reconnect = reconnect;

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

  var executor = this._executors[execId] = new Executor(
    this._server, this._router, this._instRouter, execId, token
  );
  executor.connect(callback);
}
ExecutorDriver.prototype.createExecutor = createExecutor;

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
ExecutorDriver.prototype.stop = stop;

function createInstance(executorId, instanceId, env, callback) {
  this._executors[executorId].createInstance(instanceId, env, null, callback);
}
ExecutorDriver.prototype.createInstance = createInstance;

function updateInstanceEnv(executorId, instanceId, env, callback) {
  this._containerFor(executorId, instanceId).setEnv(env, callback);
}
ExecutorDriver.prototype.updateInstanceEnv = updateInstanceEnv;

function setInstanceOptions(executorId, instanceId, options, callback) {
  this._containerFor(executorId, instanceId).setStartOptions(options, callback);
}
ExecutorDriver.prototype.setInstanceOptions = setInstanceOptions;

function _containerFor(executorId, instanceId) {
  return this._executors[executorId].containerFor(instanceId);
}
ExecutorDriver.prototype._containerFor = _containerFor;

module.exports = ExecutorDriver;
