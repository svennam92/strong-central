function MockServer() {
  this.getBaseApp = function() {
    return {};
  };

  this.getHttpServer = function() {
    return {};
  };
}

function MockWsRouter() {
  this.args = arguments;
  this.channel = null;

  this.createChannel = function() {
    this.channel = Object.create(MockWsChannel);
    MockWsChannel.apply(this.channel, arguments);
    return this.channel;
  };
}

function MockWsChannel() {
  this.args = arguments;
  var self = this;

  this.getToken = function() {
    return self.args[1] || 'channel-token';
  };

  return this;
}

exports.MockServer = MockServer;
exports.MockWsRouter = MockWsRouter;
exports.MockWsChannel = MockWsChannel;
