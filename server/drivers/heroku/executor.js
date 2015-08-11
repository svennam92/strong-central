'use strict';

var Container = require('../common/container');
var Debug = require('debug');
var assert = require('assert');
var async = require('async');
var url = require('url');

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
  this.debug = Debug('strong-central:driver:heroku:' + this._id);

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

function onRequest(req, callback) {
  return callback(new Error('executor does not support requests'));
}
Executor.prototype.onRequest = onRequest;

function _onRequest(msg, callback) {
  this.debug('on request: %j', msg);

  switch (msg.cmd) {
    case 'register-dyno':
      return this._onRegisterDyno(msg, callback);
  }
}
Executor.prototype._onRequest = _onRequest;

function _onRegisterDyno(msg, callback) {
  var meshApp = this._server.getMeshApp();
  var Instance = meshApp.models.ServiceInstance;
  var HerokuResource = meshApp.models.HerokuResource;

  HerokuResource.findById(msg.herokuResourceId, function(err, hRes) {
    if (err || !hRes) return callback({error: 'Invalid token'});
    Instance.create({
      executorId: hRes.executorId,
      serverServiceId: hRes.serverServiceId,
      groupId: 1,
      currentDeploymentId: 'not-available',
      startTime: Date.now(),
      restartCount: 0,
      PMPort: 0,
      containerVersionInfo: {
        os: msg.os,
        node: msg.node,
        container: msg.container,
      },
      started: true,
      setSize: -1,
      cpus: msg.cpus,
      applicationName: hRes.app_name,
      npmModules: {},
      agentVersion: msg.agentVersion,
      version: msg.version,
    }, function(err, inst) {
      if (err) return callback(err);
      var supervisorUrl = url.parse(HerokuResource.supervisorUrl);
      supervisorUrl.auth = inst.token;
      callback({controlUri: url.format(supervisorUrl)});
    });
  });
}
Executor.prototype._onRegisterDyno = _onRegisterDyno;

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

  container.on('start-options-updated', this._sendContainerCmd.bind(this));
  container.on('env-updated', this._sendContainerCmd.bind(this));
  container.on('deploy', this._sendContainerCmd.bind(this));
  container.on('notification', this._onInstanceNotification.bind(this));

  this._containers[options.instanceId] = container;
  callback(null, {token: container.getToken()});
  return container;
}
Executor.prototype.createInstance = createInstance;

function destroyInstance(instanceId, callback) {
  if (!this._containers[instanceId]) return setImmediate(callback);
  delete this._containers[instanceId];
}
Executor.prototype.destroyInstance = destroyInstance;

function containerFor(instanceId) {
  return this._containers[instanceId];
}
Executor.prototype.containerFor = containerFor;

function _sendContainerCmd(container, callback) {
  this.debug('inst %s: commands not supported by driver', container.getId());
  setImmediate(callback);
}
Executor.prototype._sendContainerCmd = _sendContainerCmd;

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
      return callback(Error('not supported'));
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
