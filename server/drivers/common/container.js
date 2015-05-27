var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('strong-central:container');
var lodash = require('lodash');
var util = require('util');

function Container(router, instanceId, env, token) {
  EventEmitter.call(this);

  this._id = instanceId;
  this._token = token;
  this._containerOptions = {};
  this._env = env || {};

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
  if (!lodash.isEqual(options, this._containerOptions)) {
    this._containerOptions = options;
    this.emit('start-options-updated', this, callback);
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
  env = lodash.mapValues(env, function(x) {
    return String(x);
  });

  if (!lodash.isEqual(env, this._env)) {
    this._env = env;
    this.emit('env-updated', this, callback);
  }
  process.nextTick(callback);
}
Container.prototype.setEnv = setEnv;

function _onNotification(msg, callback) {
  debug('Supervisor message: %j', msg);
  callback({});
}
Container.prototype._onNotification = _onNotification;

module.exports = Container;
