'use strict';

var BaseExecutor = require('../common/executor');
var Debug = require('debug');
var url = require('url');
var util = require('util');
var fmt = util.format;

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
function Executor() {
  BaseExecutor.apply(this, arguments);
  this.debug = Debug('strong-central:driver:heroku:' + this._id);
  this.debug('create: token %s', this._token);
}
util.inherits(Executor, BaseExecutor);
module.exports = Executor;

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
      herokuResourceId: msg.herokuResourceId,
    }, function(err, inst) {
      if (err) {
        return hRes.log(HerokuResource.DYNO_STARTED, {msg: msg}, err, callback);
      }

      hRes.log(
        HerokuResource.DYNO_STARTED,
        {msg: msg, instanceId: inst.id},
        err
      );

      var supervisorUrl = url.parse(HerokuResource.supervisorUrl);
      supervisorUrl.auth = inst.token;
      callback({controlUri: url.format(supervisorUrl), instanceId: inst.id});
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
  container.on('disconnect-exit', this._onInstanceExit.bind(this));

  this._containers[options.instanceId] = container;
  callback(null, {token: container.getToken()});
  return container;
}
Executor.prototype.createInstance = createInstance;

function _onInstanceExit(instanceId) {
  var meshApp = this._server.getMeshApp();
  var Instance = meshApp.models.ServiceInstance;
  var HerokuResource = meshApp.models.HerokuResource;
  var self = this;

  Instance.findById(instanceId, function(err, inst) {
    if (err) {
      return self.debug(
        fmt('Dyno exited but instance not found %s', err.message)
      );
    }

    inst.herokuResource(function(err, herokuResource) {
      if (err) {
        return self.debug(
          fmt('Error retrieving heroku resource: %s', err.message)
        );
      }

      inst.updateAttributes({
        stopTime: Date.now(),
      }, function(err) {
        herokuResource.log(
          HerokuResource.DYNO_STOPPED, {instanceId: instanceId}, err
        );
        if (err) {
          self.debug(
            fmt('Dyno exited but error updating model: %s', err.message)
          );
        }
      });
    });
  });
}
Executor.prototype._onInstanceExit = _onInstanceExit;

function destroyInstance(instanceId, callback) {
  if (!this._containers[instanceId]) return setImmediate(callback);
  delete this._containers[instanceId];
}
Executor.prototype.destroyInstance = destroyInstance;

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
