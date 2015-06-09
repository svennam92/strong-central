var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('strong-central:container');
var lodash = require('lodash');
var util = require('util');

function Container(server, router, instanceId, env, token) {
  EventEmitter.call(this);

  this._id = instanceId;
  this._token = token;
  this._containerOptions = {};
  this._env = env || {};
  this._server = server;

  this._channel = router.createChannel(
    this._onNotification.bind(this),
    token
  );
  this._token = this._channel.getToken();
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
  return this._containerOptions;
}
Container.prototype.getStartOptions = getStartOptions;

/**
 * Close connection to remote exeutor
 *
 * @param {function} callback fn(err)
 */
function close(callback) {
  this.removeAllListeners();
  this._channel.close(callback);
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

  if (!lodash.isEqual(options, this._containerOptions)) {
    this._containerOptions = options;
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
  debug('Supervisor message: %j', msg);
  this._server.onInstanceNotification(this._id, msg, callback);
}
Container.prototype._onNotification = _onNotification;

module.exports = Container;
