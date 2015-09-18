'use strict';

var Container = require('../common/container');
var assert = require('assert');
var async = require('async');

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
function BaseExecutor(options) {
  this._server = options.server;
  this._execRouter = options.executorRouter;
  this._instRouter = options.instanceRouter;
  this._id = options.executorId;
  this._token = options.token;
  this._hasStarted = false;
  this._containers = {};

  this._Container = options.Container || Container;
  this._channel = null;
}
module.exports = BaseExecutor;

function getToken() {
  return this._token;
}
BaseExecutor.prototype.getToken = getToken;

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
BaseExecutor.prototype.listen = listen;

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
BaseExecutor.prototype.close = close;

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
BaseExecutor.prototype.disconnect = disconnect;

function containerFor(instanceId) {
  return this._containers[instanceId];
}
BaseExecutor.prototype.containerFor = containerFor;
