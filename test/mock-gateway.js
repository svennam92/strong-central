'use strict';

var WebsocketChannel = require('strong-control-channel/ws-channel');
var debug = require('debug')('test:gateway');
var url = require('url');

module.exports = Gateway;

function Gateway(controlUri, token, onRequest, onConnected) {
  var self = this;
  controlUri.auth = token;
  controlUri.pathname = '/gateway-control';
  self._control = url.format(controlUri);

  self.channel = WebsocketChannel.connect(
    onRequest,
    self._control
  );

  setTimeout(function() {
    self.channel.request({
      cmd: 'starting',
    }, function(rsp) {
      debug('started: %j', rsp);
      onConnected(self);
    });
  }, 1000);
}

Gateway.prototype._request = function(req, callback) {
  debug('request: %j', req);
  this.channel.request(req, function(rsp) {
    debug('response: %j', rsp);
    callback(rsp);
  });
};
