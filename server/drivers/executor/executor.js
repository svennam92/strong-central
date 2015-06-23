'use strict';

var Container = require('../common/container');
var async = require('async');
var debug = require('debug')('strong-central:driver:executor:executor');
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

  this._Container = options.Container || Container;
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
 * @param {string} instanceId
 * @param {object} instEnv
 * @param {string} token auth token for instance if available. Will be generated
 * if not provided
 */
function createInstance(instanceId, instEnv, deploymentId, token, callback) {
  var container = this._containers[instanceId] = new this._Container({
    server: this._server,
    router: this._instRouter,
    instanceId: instanceId,
    env: instEnv,
    deploymentId: deploymentId,
    token: token,
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
  debug(
    'New container artifact %j for instance %s (ex: %s)',
    container.getDeploymentId(), container.getId(), this._id
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
  debug(
    'Deploying artifact %j for instance %s (ex: %s)',
    container.getDeploymentId(), container.getId(), this._id
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
    debug('Executor %s has not started, discarding command: %j', this._id, msg);
    return callback();
  }

  debug('request %j of executor %s', msg, this._id);
  this._channel.request(msg, function(res) {
    debug('request <-- (%j)', res);
    if (res.error) {
      // XXX: ignore error till executor implements required commands
      // callback(Error(res.error));
      return callback(null, {});
    }

    callback(null, res);
  });
}
Executor.prototype._request = _request;

function _onNotification(msg, callback) {
  debug('Notification from exec: %s, msg: %j', this._id, msg);

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

  async.series([
    server.updateExecutorData.bind(
      server, this._id, msg.hostname, msg.ip,
      msg.cpus.length, {remoteDriver: msg.driver}
    ),
    function reissueContainerCmds(callback) {
      async.each(Object.keys(self._containers),
        function(cId, callback) {
          self._sendContainerCreateCmd(self._containers[cId], callback);
        }, callback
      );
    }
  ], function(err) {
    if (err) return callback({error: err.message});
    callback({});
  });
}
Executor.prototype._onStarting = _onStarting;
