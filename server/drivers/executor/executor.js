var Container = require('../common/container');
var async = require('async');
var debug = require('debug')('strong-central:driver:executor:executor');

/**
 * Proxy to the executor running on a remote machine.
 *
 * @param {Server} server Central server
 * @param {WS-Router} execRouter Executor websocket router endpoint
 * @param {WS-Router} instRouter Instance websocket router endpoint
 * @param {string} execId Executor ID
 * @param {string} token Auth token
 * @constructor
 */
function Executor(server, execRouter, instRouter, execId, token) {
  this._server = server;
  this._router = execRouter;
  this._instRouter = instRouter;
  this._id = execId;
  this._token = token;
  this._hasStarted = false;
  this._containers = {};
}
module.exports = Executor;

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
function createInstance(instanceId, instEnv, token, callback) {
  var container = this._containers[instanceId] = new Container(
    this._instRouter,
    instanceId,
    instEnv,
    token
  );
  container.on('start-options-updated',
    this._sendContainerOptionsCmd.bind(this));
  container.on('env-updated', this._sendContainerEnvCmd.bind(this));
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

function _sendContainerCreateCmd(container, callback) {
  this._request({
    cmd: 'container-create',
    id: container.getId(),
    env: container.getEnv(),
    startOptions: container.getStartOptions(),
    token: container.getToken(),
  }, callback);
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

function _sendContainerOptionsCmd(container, callback) {
  this._request({
    cmd: 'container-start-options',
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
