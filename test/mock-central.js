var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;

function MockServer() {
  this.getBaseApp = function() {
    return {};
  };

  this.getHttpServer = function() {
    return {};
  };
}

function MockWsRouter(/*server, app, path*/) {
  this.args = arguments;
  this.channel = null;

  this.acceptClient = function(onRequest, token) {
    return new MockClient(onRequest, token, this);
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

exports.MockServer = MockServer;
exports.MockWsRouter = MockWsRouter;
exports.MockWsChannel = MockWsChannel;
