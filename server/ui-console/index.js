var boot = require('loopback-boot');
var express = require('express');
var path = require('path');
var browserBundle = require('strong-mesh-client/proxy/build-client.js');

function UIConsole(server) {
  this._server = server;
  var meshApp = this._server.getMeshApp();
  var baseApp = this._server.getBaseApp();
  boot(meshApp, __dirname);

  baseApp.use('/dashboard', require('express-jsxtransform')());
  baseApp.use('/dashboard',
    express.static(path.join(require.resolve('strong-arc'), '../../client/www'))
  );

  baseApp.get('/manager/client.js', function(req, res) {
    res.set('Content-Type', 'application/javascript');
    browserBundle.getBundle(res, './client.map.json', function(err) {
      if (err) {
        console.error('(strong-mesh-client) client.map.json is not available');
        console.error(err.stack || err.message);
        res.end();
      }
    });
  });

  baseApp.get('/manager/client.map.json', function(req, res) {
    browserBundle.getBundleMap(res, function(err) {
      if (err) {
        console.error('(strong-mesh-client) Error building client.map.json');
        console.error(err.stack || err.message);
        res.end();
      }
    });
  });
}

function init(callback) {
  setImmediate(callback);
}
UIConsole.prototype.init = init;

module.exports = UIConsole;
