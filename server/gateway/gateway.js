'use strict';

var Debug = require('debug');
var EventEmitter = require('events').EventEmitter;
var assert = require('assert');
var mandatory = require('../util').mandatory;
var util = require('util');

/**
 * @param {object} options
 * @param {Server} options.server Central server
 * @param {WS-Router} options.router Instance websocket router endpoint
 * @param {strong} options.instanceId Id of Instance managed by this container
 * @param {object} options.env Container environment
 * @param {string} options.deploymentId Commit hash to be deployed
 * @param {string} options.token WS auth token
 * @constructor
 */
function Gateway(options) {
  EventEmitter.call(this);
  mandatory(options);
  mandatory(options.id);
  mandatory(options.router);

  this.debug = Debug('strong-central:gateway:' + options.id);
  this._id = options.id;
  this._gwRouter = options.router;
  this._hasStarted = false;
  this._token = options.token;
}
util.inherits(Gateway, EventEmitter);

function listen(callback) {
  this.debug('listen: token %s', this._token);

  var client = this._client = this._gwRouter.acceptClient(
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
      self.disconnect('gateway-replaced');
    }
    self._channel = channel;

    channel.on('error', function(err) {
      self.disconnect('gateway-' + err.message);
    });
  });

  // TBD - how/when will we decide that an gateway is dead/unavailable?

  callback(null, {
    token: client.getToken()
  });
}
Gateway.prototype.listen = listen;

function _onRequest(msg, callback) {
  this.debug('on request: %j', msg);

  switch (msg.cmd) {
    case 'starting':
      this._hasStarted = true;
      return this.emit('resync', this._id, callback);
    default:
      this.debug('unknown message. ignoring');
  }
}
Gateway.prototype._onRequest = _onRequest;

function _request(req, callback) {
  if (!this._hasStarted) {
    this.debug('request: not started, discarding %j', req);
    return callback();
  }
  this._channel.request(req, function(res) {
    if (res && res.error) return callback(Error(res.error));
    callback(null, res);
  });
}
Gateway.prototype._request = _request;

/**
 * Perform a full sync. This will erase all endpoints on the gateway and create
 * new ones.
 * @param  {object}      serviceEndpoints Array of services and endpoints.
 * @param  {Function}    callback         Callback function.
 */
function sync(serviceEndpoints, callback) {
  this._request({
    cmd: 'sync',
    data: serviceEndpoints,
  }, callback);
}
Gateway.prototype.sync = sync;

/**
 * Update gateway with new service endpoint information.
 * @param  {object}      serviceEndpoints Service endpoints.
 * @param  {Function}    callback         Callback function.
 */
function update(serviceEndpoints, callback) {
  this._request({
    cmd: 'update',
    data: serviceEndpoints,
  }, callback);
}
Gateway.prototype.update = update;

function close(callback) {
  this._client.close(callback);
}
Gateway.prototype.close = close;

function disconnect(reason) {
  var self = this;

  this.debug('disconnect because %s', reason);

  if (self._channel) {
    self._channel.close(reason);
    self._channel = null;
  }

  self._hasStarted = false;
}
Gateway.prototype.disconnect = disconnect;

module.exports = Gateway;
