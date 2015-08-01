'use strict';

var Container = require('../common/container');
var Debug = require('debug');
var assert = require('assert');
var async = require('async');
var fmt = require('util').format;
var extend = require('../../util').extend;

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
  this._execRouter = options.executorRouter;
  this._instRouter = options.instanceRouter;
  this._id = options.executorId;
  this._token = options.token;
  this._hasStarted = false;
  this._containers = {};
  this.debug = Debug('strong-central:driver:executor:' + this._id);

  this._Container = options.Container || Container;
  this._channel = null;

  this.debug('create: token %s', this._token);
}
module.exports = Executor;

function getToken() {
  return this._token;
}
Executor.prototype.getToken = getToken;

function listen(callback) {
  this.debug('listen: token %s', this._token);

  var client = this._client = this._execRouter.acceptClient(
    this._onRequest.bind(this),
    this._token
  );
  var token = this._client.getToken();

  if (this._token) {
    assert.equal(token, this._token);
  } else {
    this._token = token;
    this.debug('allocated token %s', this._token);
  }

  var self = this;
  client.on('new-channel', function(channel) {
    self.debug('new-channel %s old channel %s started? %j',
      channel.getToken(),
      self._channel ? self._channel.getToken() : '(none)',
      self._hasStarted
      );
    if (self._channel) {
      self.disconnect('executor-replaced');
    }
    self._channel = channel;

    channel.on('error', function(err) {
      self.disconnect('executor-' + err.message);
    });
  });

  // XXX(sam) why is this a callback if its sync?
  callback(null, this, {
    token: client.getToken()
  });
}
Executor.prototype.listen = listen;

function close(callback) {
  this.debug('close');

  var self = this;

  // XXX(sam) can new containers be created while we are closing? Maybe
  // we should mark Executor as closed immediately?
  async.each(Object.keys(this._containers), function(cId, callback) {
    self._containers[cId].close(callback);
  }, function(err) {
    if (err) return callback(err);

    self._client.close(callback);
  });
}
Executor.prototype.close = close;

function disconnect(reason) {
  var self = this;

  this.debug('disconnect because %s', reason);

  Object.keys(self._containers).forEach(function(cId) {
    self._containers[cId].disconnect(reason);
  });

  if (self._channel) {
    self._channel.close(reason);
    self._channel = null;
  }

  self._hasStarted = false;

  // XXX(sam) Is there any way to mark an executor as connected/unconnected in
  // the mesh models? We could list connection status and remote ip in exec-list
  // output.
}
Executor.prototype.disconnect = disconnect;

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
  container.on('notification', this._onInstanceNotification.bind(this));
  this._sendContainerCreateCmd(container, function(err) {
    if (err) return callback(err);
    callback(null, {
      token: container.getToken()
    });
  });
  return container;
}
Executor.prototype.createInstance = createInstance;

function destroyInstance(instanceId, callback) {
  if (!this._containers[instanceId]) return setImmediate(callback);

  var self = this;
  this._sendContainerDestroyCmd(instanceId, function(err) {
    if (err) return callback(err);

    delete self._containers[instanceId];
    callback();
  });
}
Executor.prototype.destroyInstance = destroyInstance;

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
    cmd: 'container-set-env',
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
  var self = this;
  if (!self._hasStarted) {
    self.debug('request: not started, discarding %j', msg);
    return callback();
  }

  self.debug('request: %j', msg);
  self._channel.request(msg, function(res) {
    self.debug('response: %j', res);
    if (res.error) {
      return callback(new Error(res.error));
    }
    callback(null, res);
  });
}
Executor.prototype._request = _request;

function _onRequest(msg, callback) {
  this.debug('on request: %j', msg);

  switch (msg.cmd) {
    case 'starting':
      return this._onStarting(msg, callback);
    case 'container-exit':
      return this._onContainerExit(msg, callback);
  }
}
Executor.prototype._onRequest = _onRequest;

/**
 * Inform container that supervisor has exited so it can record the event
 * and update its state.
 *
 * @param {object} msg
 * @param {function} callback
 * @private
 */
function _onContainerExit(msg, callback) {
  this._server.markOldProcessesStopped(msg.id, callback);
}
Executor.prototype._onContainerExit = _onContainerExit;

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
      server, this._id, msg.hostname, msg.address,
      msg.cpus, {remoteDriver: msg.driver}
    ),
    function reissueContainerCmds(next) {
      async.each(Object.keys(self._containers), function(cId, callback) {
        self._sendContainerCreateCmd(self._containers[cId], callback);
      }, next);
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
    console.error('Error handling executor started: %s', err.message);
  });
}
Executor.prototype._onStarting = _onStarting;

function instanceRequest(instanceId, req, callback) {
  var self = this;

  this.debug('instanceRequest -> %s, %j', instanceId, req);
  function cbWrapper(rsp) {
    self.debug('instanceRequest <- %j', arguments);
    if (rsp && rsp.error) {
      return callback(Error(rsp.error));
    }
    return callback(null, rsp);
  }

  switch (req.cmd) {
    case 'stop':
    case 'start':
    case 'restart':
    case 'soft-stop':
    case 'soft-restart':
      var executorRequest = extend(req, {
        cmd: 'container-' + req.cmd,
        id: instanceId,
      });
      var container = this.containerFor(instanceId);
      async.series([
        this._request.bind(this, executorRequest),
        function(callback) {
          if (req.cmd === 'soft-stop' || req.cmd === 'soft-restart') {
            return container.request({cmd: 'stop'}, callback);
          }
          if (callback) setImmediate(callback);
        }
      ], cbWrapper);
      break;
    default:
      if (req.cmd === 'current') req.cmd = req.sub;
      this.containerFor(instanceId).request(req, cbWrapper);
  }
}
Executor.prototype.instanceRequest = instanceRequest;

function _onInstanceNotification(instanceId, msg, callback) {
  // Don't propogate message if container was deleted
  if (!this._containers[instanceId]) return setImmediate(callback);

  this._server.onInstanceNotification(instanceId, msg, callback);
}
Executor.prototype._onInstanceNotification = _onInstanceNotification;
