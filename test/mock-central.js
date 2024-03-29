var EventEmitter = require('events').EventEmitter;
var assert = require('assert');
var inherits = require('util').inherits;

function MockServer() {
  this.getBaseApp = function() {
    return {};
  };

  this.getHttpServer = function() {
    return {};
  };

  this.markOldProcessesStopped = function(instanceId, callback) {
    return callback();
  };
}

function MockWsRouter(/*server, app, path*/) {
  this.args = arguments;
  this.client = null;

  this.acceptClient = function(onRequest, token) {
    this.client = new MockClient(onRequest, token, this);
    return this.client;
  };
}

function MockClient(onRequest, token, router) {
  EventEmitter.call(this);

  this.onRequest = onRequest;
  this.token = token || 'client-token';
  this.router = router;

  this.channel = new MockWsChannel(this.onRequest);
  this.router.channel = this.channel;
  process.nextTick(this.emit.bind(this, 'new-channel', this.channel));
}

inherits(MockClient, EventEmitter);

MockClient.prototype.getToken = function() {
  return this.token;
};

MockClient.prototype.close = function(cb) {
  if (cb) process.nextTick(cb);
  return this;
};

function MockWsChannel(onRequest) {
  this.onRequest = onRequest;
}

MockWsChannel.prototype.getToken = function() {
  return this.token;
};

MockWsChannel.prototype.close = function() {};

MockWsChannel.prototype.on = function(event, listener) {
  assert.equal(event, 'error', 'error is the only supported event');
  this.onError = listener;
};

exports.MockServer = MockServer;
exports.MockWsRouter = MockWsRouter;
exports.MockWsChannel = MockWsChannel;
