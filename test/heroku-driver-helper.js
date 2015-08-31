var EventEmitter = require('events').EventEmitter;
var HerokuDriver = require('../server/drivers/heroku');
var MockServer = require('./mock-central').MockServer;
var MockWsRouter = require('./mock-central').MockWsRouter;
var ServiceManager = require('strong-mesh-models').ServiceManager;
var debug = require('debug')('strong-central:test:heroku-helper');
var meshServer = require('strong-mesh-models').meshServer;
var mkdirp = require('mkdirp');
var mktmpdir = require('mktmpdir');
var path = require('path');
var test = require('tap').test;
var testOptions = require('./heroku-test-options.json');
var util = require('util');

function MockContainer() {
  this.getDeploymentId = function() {
    return 'commithash';
  };
  this.getId = function() {
    return 'i1';
  };
  this.getEnv = function() {
    return {};
  };
  this.getStartOptions = function() {
    return {};
  };
  this.getToken = function() {
    return 'container-token';
  };
  this.updateContainerMetadata = function(data, callback) {
    callback();
  };
}
util.inherits(MockContainer, EventEmitter);
exports.MockContainer = MockContainer;

exports.testHelper = function(runTest) {
  test('Test Heroku driver', function(t) {
    mktmpdir(function(err, dir, cleanup) {
      t.ifError(err);

      var baseDir = path.join(dir, 'base');
      debug('baseDir: %s', dir);

      var server = new MockServer();
      server._meshApp = meshServer(new ServiceManager, null, {
        dbFilePath: path.join(baseDir, 'memorydb.json')
      });
      server.getMeshApp = function() {
        return server._meshApp;
      };

      var driver = new HerokuDriver({
        baseDir: baseDir,
        server: server,
        WebsocketRouter: MockWsRouter,
        Container: MockContainer,
        config: testOptions,
      });

      mkdirp(baseDir, function(err) {
        t.ifError(err);
        runTest(t, baseDir, server._meshApp, driver);
        t.end();
      });

      t.on('end', cleanup);
    });
  });
};
