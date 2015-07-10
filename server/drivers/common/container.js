var Debug = require('debug');
var EventEmitter = require('events').EventEmitter;
var assert = require('assert');
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

  this._client = options.router.acceptClient(
    this._onNotification.bind(this),
    this._token
  );
  this._token = this._client.getToken();
  // FIXME(sam) Container doesn't have a request() method... but if it did, it
  // would have to listen on client 'new-channel' to get channels from the
  // supervisor, closing the old one. See how Executor does it, this would be
  // almost identical.
  this._channel = null;
  this.debug = Debug('strong-central:container:' + options.instanceId);

  this.debug('Container %j', {
    id: options.instanceId,
    token: this._token,
    startOptions: options.startOptions,
    env: options.env,
    deploymentId: options.deploymentId,
  });

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

  var changed = false;
  for (var i in options) {
    if (this._startOptions[i] !== options[i]) {
      this._startOptions[i] = options[i];
      changed = true;
    }
  }

  if (changed) {
    return this.emit('start-options-updated', this, callback);
  }
  process.nextTick(callback);
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
  this.debug('Supervisor message: %j', msg);
  this._server.onInstanceNotification(this._id, msg, callback);
}
Container.prototype._onNotification = _onNotification;

module.exports = Container;
