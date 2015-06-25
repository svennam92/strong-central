'use strict';

var Container = require('../common/container');
var async = require('async');
var debug = require('debug');
var fmt = require('util').format;

/**
 * Proxy to the executor running on a remote machine.
 *
 * @param {object} options
 * @param {Server} options.server Central server
 * @param {WS-Router} options.execRouter Executor websocket router endpoint
 * @param {WS-Router} options.instance Router Instance websocket router endpoint
 * @param {string} options.executorId Executor ID
 * @param {string} options.token Auth token
 * @constructor
 */
function Executor(options) {
  this._server = options.server;
  this._router = options.execRouter;
  this._instRouter = options.instanceRouter;
  this._id = options.executorId;
  this._token = options.token;
  this._hasStarted = false;
  this._containers = {};
  this.debug = debug('strong-central:driver:executor:' + this._id);

  this._Container = options.Container || Container;

  this.debug('create: token %s', this._token);
}
module.exports = Executor;

function getToken() {
  return this._token;
}
Executor.prototype.getToken = getToken;

function connect(callback) {
  var channel = this._channel = this._router.createChannel(
    this._onNotification.bind(this),
    this._token
  );
  this._token = this._channel.getToken();

  this.debug('connect: token %s', this._token);

  callback(null, this, {
    token: channel.getToken()
  });
}
Executor.prototype.connect = connect;

function close(callback) {
  var self = this;

  async.each(Object.keys(this._containers), function(cId, callback) {
    self._containers[cId].close(callback);
  }, function(err) {
    if (err) return callback(err);

    self._channel.close(callback);
  });
}
Executor.prototype.close = close;

/**
 * Create an instance on the executor. This will send create commands if the
 * executor is up and running.
 *
 * @param {object} options
 * @param {string} options.instanceId
 * @param {object} options.env
 * @param {string} options.token auth token for instance if available. Will be
 * generated if not provided
 * @param {object} options.startOptions
 */
// instanceId, instEnv, deploymentId, token, callback
function createInstance(options, callback) {
  var container = this._containers[options.instanceId] = new this._Container({
    server: this._server,
    router: this._instRouter,
    instanceId: options.instanceId,
    env: options.env,
    deploymentId: options.deploymentId,
    token: options.token,
    startOptions: options.startOptions,
  });

  container.on('start-options-updated',
    this._sendContainerOptionsCmd.bind(this));
  container.on('env-updated', this._sendContainerEnvCmd.bind(this));
  container.on('deploy', this._sendContainerDeployCmd.bind(this));
  this._sendContainerCreateCmd(container, function(err) {
    if (err) return callback(err);
    callback(null, {
      token: container.getToken()
    });
  });
  return container;
}
Executor.prototype.createInstance = createInstance;

function containerFor(instanceId) {
  return this._containers[instanceId];
}
Executor.prototype.containerFor = containerFor;

function onRequest(req, callback) {
  if (!this._hasStarted)
    return callback(new Error(fmt('executor %d has not started', this._id)));

  this._request(req, callback);
}

Executor.prototype.onRequest = onRequest;

function _sendContainerCreateCmd(container, callback) {
  this.debug('create: deployment %j for instance %s',
    container.getDeploymentId(), container.getId()
  );

  return this._sendContainerDeployCmd(container, callback);
}
Executor.prototype._sendContainerCreateCmd = _sendContainerCreateCmd;

function _sendContainerEnvCmd(container, callback) {
  this._request({
    cmd: 'container-env-set',
    id: container.getId(),
    env: container.getEnv(),
  }, callback);
}
Executor.prototype._sendContainerEnvCmd = _sendContainerEnvCmd;

function _sendContainerDeployCmd(container, callback) {
  this.debug(
    'deploy: deployment %j for instance %s',
    container.getDeploymentId(), container.getId()
  );

  this._request({
    cmd: 'container-deploy',
    deploymentId: container.getDeploymentId(),
    env: container.getEnv(),
    id: container.getId(),
    options: container.getStartOptions(),
    token: container.getToken(),
  }, function(err, data) {
    if (err) return callback(err);

    container.updateContainerMetadata(data, callback);
  });
}
Executor.prototype._sendContainerDeployCmd = _sendContainerDeployCmd;


function _sendContainerOptionsCmd(container, callback) {
  this._request({
    cmd: 'container-set-options',
    id: container.getId(),
    options: container.getStartOptions(),
  }, callback);
}
Executor.prototype._sendContainerOptionsCmd = _sendContainerOptionsCmd;

function _sendContainerDestroyCmd(instanceId, callback) {
  this._request({
    cmd: 'container-destroy',
    id: instanceId,
  }, callback);
}
Executor.prototype._sendContainerDestroyCmd = _sendContainerDestroyCmd;

function _request(msg, callback) {
  if (!this._hasStarted) {
    this.debug('request: not started, discarding %j', this._id, msg);
    return callback();
  }

  this.debug('request: %j', msg);
  this._channel.request(msg, function(res) {
    this.debug('response: %j', res);
    if (res.error) {
      return callback(new Error(res.error));
    }
    callback(null, res);
  });
}
Executor.prototype._request = _request;

function _onNotification(msg, callback) {
  debug('on notification: %j', msg);

  switch (msg.cmd) {
    case 'starting':
      return this._onStarting(msg, callback);
  }
}
Executor.prototype._onNotification = _onNotification;

/**
 * When executor reports started state, store information reported by executor
 * and (re)issue container commands.
 *
 * @param {object} msg
 * @param {function} callback
 * @private
 */
function _onStarting(msg, callback) {
  var server = this._server;
  var self = this;
  this._hasStarted = true;

  callback({message: 'ok'});

  async.series([
    server.updateExecutorData.bind(
      server, this._id, msg.hostname, msg.ip,
      msg.cpus, {remoteDriver: msg.driver}
    ),
    function reissueContainerCmds(callback) {
      async.each(Object.keys(self._containers),
        function(cId, callback) {
          self._sendContainerCreateCmd(self._containers[cId], callback);
        }, callback
      );
    }
  ], function(err) {
    if (!err) return;
    // XXX(sam) Don't pass our internal errors back to the executor, it can't
    // do anything about them. Handle them here, if it is possible. Probably,
    // it is not, they shouldn't have been passed to us.
    //
    // For example, server.updateExecutorData() should probably assert on
    // failure and not pass its errors to us. If server can't handle its DB
    // failures, the executor driver won't be able to.
    console.error('Error handling executor %s started: %s',
      this._id, err.message);
  });
}
Executor.prototype._onStarting = _onStarting;
