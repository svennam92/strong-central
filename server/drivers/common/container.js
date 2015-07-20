var Debug = require('debug');
var EventEmitter = require('events').EventEmitter;
var assert = require('assert');
var async = require('async');
var lodash = require('lodash');
var mandatory = require('../../util').mandatory;
var util = require('util');

/**
 *
 * @param {object} options
 * @param {Server} options.server Central server
 * @param {WS-Router} options.router Instance websocket router endpoint
 * @param {strong} options.instanceId Id of Instance managed by this container
 * @param {object} options.env Container environment
 * @param {string} options.deploymentId Commit hash to be deployed
 * @param {string} options.token WS auth token
 * @constructor
 */
function Container(options) {
  EventEmitter.call(this);

  this._id = mandatory(options.instanceId);
  this._token = options.token;
  this._startOptions = options.startOptions;
  this._env = options.env || {};
  this._server = options.server;
  this._deploymentId = options.deploymentId;
  this.debug = Debug('strong-central:container:' + options.instanceId);

  this._client = options.router.acceptClient(
    this._onNotification.bind(this),
    this._token
  );
  var token = this._client.getToken();

  if (this._token) {
    assert.equal(token, this._token);
  } else {
    this._token = token;
    this.debug('allocated token %s', this._token);
  }

  this._channel = null;
  var self = this;
  this._client.on('new-channel', function(channel) {
    self.debug('new-channel %s old channel %s started? %j',
      channel.getToken(),
      self._channel ? self._channel.getToken() : '(none)',
      self._hasStarted
      );
    if (self._channel)
      self._channel.close();
    self._channel = channel;
    self._hasStarted = false;
    self._server.markOldProcessesStopped(self._id, function(err) {
      if (err)
        self.debug('Error marking old processes as stopped: %s', err.message);
    });
  });

  this.debug('Container %j', {
    id: options.instanceId,
    token: this._token,
    startOptions: options.startOptions,
    env: options.env,
    deploymentId: options.deploymentId,
  });
  this._hasStarted = false;
}
util.inherits(Container, EventEmitter);

function getToken() {
  return this._token;
}
Container.prototype.getToken = getToken;

function getId() {
  return this._id;
}
Container.prototype.getId = getId;

function getEnv() {
  return this._env;
}
Container.prototype.getEnv = getEnv;

function getStartOptions() {
  return this._startOptions;
}
Container.prototype.getStartOptions = getStartOptions;

function deploy(deploymentId, callback) {
  if (this.listeners('deploy').count > 1)
    return callback(
      Error('only one listener is supported for deploy event'));

  if (this._deploymentId !== deploymentId) {
    assert(deploymentId);
    this._deploymentId = deploymentId;
    return this.emit('deploy', this, callback);
  }
  process.nextTick(callback);
}
Container.prototype.deploy = deploy;

function getDeploymentId() {
  return this._deploymentId;
}
Container.prototype.getDeploymentId = getDeploymentId;

/**
 * Close connection to remote supervisor
 *
 * @param {function} callback fn(err)
 */
function close(callback) {
  this.removeAllListeners();
  this._client.close(callback);
}
Container.prototype.close = close;

/**
 * Set startup options for remote container. This command will issue commands
 * to the remote executor if needed.
 *
 * @param {object} options Remote container startup options
 * @param {function} callback fn(err)
 */
function setStartOptions(options, callback) {
  if (this.listeners('start-options-updated').count > 1)
    return callback(
      Error('only one listener is supported for start-options-updated event'));

  var changes = {};
  for (var i in options) {
    if (this._startOptions[i] !== options[i]) {
      this._startOptions[i] = options[i];
      changes[i] = options[i];
    }
  }

  var tasks = [];
  if (Object.keys(changes).length > 0) {
    tasks.push(this.emit.bind(this, 'start-options-updated', this));
  }
  if (changes.hasOwnProperty('size')) {
    tasks.push(this.request.bind(this, {cmd: 'set-size', size: changes.size}));
  }
  if (changes.hasOwnProperty('trace')) {
    tasks.push(this.request.bind(this,
      {cmd: 'tracing', enabled: changes.trace})
    );
  }
  async.series(tasks, callback);
}
Container.prototype.setStartOptions = setStartOptions;

/**
 * Set the environment for the remote container. This command will issue
 * commands to the remote executor if needed.
 *
 * @param {object} env Environment variables
 * @param {function} callback fn(err)
 */
function setEnv(env, callback) {
  if (this.listeners('env-updated').count > 1)
    return callback(
      Error('only one listener is supported for env-updated event'));

  env = lodash.mapValues(env, function(x) {
    return String(x);
  });

  if (!lodash.isEqual(env, this._env)) {
    this._env = env;
    return this.emit('env-updated', this, callback);
  }
  process.nextTick(callback);
}
Container.prototype.setEnv = setEnv;

function updateContainerMetadata(metadata, callback) {
  this._server.setInstanceMetadata(this._id, metadata, callback);
}
Container.prototype.updateContainerMetadata = updateContainerMetadata;

function _onNotification(msg, callback) {
  this.debug('Message from supervisor: %j', msg);
  var self = this;

  if (msg.cmd === 'started') {
    self._hasStarted = true;
  }
  this._server.onInstanceNotification(this._id, msg, callback);
}
Container.prototype._onNotification = _onNotification;

function request(req, callback) {
  if (!this._hasStarted) {
    this.debug('request: not started, discarding %j', req);
    return callback();
  }
  this._channel.request(req, callback);
}
Container.prototype.request = request;

module.exports = Container;
