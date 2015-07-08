'use strict';

var WebsocketChannel = require('strong-control-channel/ws-channel');
var debug = require('debug')('test:executor');
var url = require('url');
var os = require('os');

module.exports = Executor;

function Executor(controlUri, token, onRequest, onConnected) {
  var self = this;
  controlUri.auth = token;
  controlUri.pathname = '/executor-control';
  self._control = url.format(controlUri);

  self.channel = WebsocketChannel.connect(
    onRequest,
    self._control
  );

  setTimeout(function() {
    self.channel.request({
      cmd: 'starting',
      hostname: os.hostname(),
      cpus: os.cpus().length,
      driver: 'MockDriver',
    }, function(rsp) {
      debug('started: %j', rsp);
      onConnected(self);
    });
  }, 1000);
}

Executor.prototype.request = function(req, callback) {
  debug('request: %j', req);
  this.channel.request(req, function(rsp) {
    debug('response: %j', rsp);
    callback(rsp);
  });
};

Executor.prototype.notify = function(req) {
  debug('notification: %j', req);
  this.channel.notify(req);
};
