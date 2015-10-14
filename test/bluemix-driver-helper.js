var BluemixDriver = require('../server/drivers/bluemix');
var debug = require('debug')('strong-central:test:bluemix-helper');
var EventEmitter = require('events').EventEmitter;
var meshServer = require('strong-mesh-models').meshServer;
var mkdirp = require('mkdirp');
var mktmpdir = require('mktmpdir');
var MockServer = require('./mock-central').MockServer;
var MockWsRouter = require('./mock-central').MockWsRouter;
var nconf = require('nconf');
var path = require('path');
var PostgreSQL = require('loopback-connector-postgresql');
var ServiceManager = require('strong-mesh-models').ServiceManager;
var test = require('tap').test;
var url = require('url');
var util = require('util');

nconf.file('driver', path.resolve(__dirname, './bluemix-test-options.json'));

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
  this.request = function(req, callback) {
    setImmediate(callback);
  };
}
util.inherits(MockContainer, EventEmitter);
exports.MockContainer = MockContainer;

exports.testHelper = function(runTest) {
  test('Test Bluemix driver', function(t) {
    mktmpdir(function(err, dir, cleanup) {
      t.ifError(err);

      var baseDir = path.join(dir, 'base');
      debug('baseDir: %s', dir);

      var postgresUrl = url.parse('postgres://');
      if (process.env.POSTGRESQL_USER) {
        postgresUrl.auth =
          process.env.POSTGRESQL_USER + ':' + process.env.POSTGRESQL_PASSWORD;
      }
      postgresUrl.hostname = process.env.POSTGRESQL_HOST || 'localhost';
      postgresUrl.port = process.env.POSTGRESQL_PORT || 5432;
      postgresUrl.path = process.env.POSTGRESQL_DATABASE || 'test';

      var server = new MockServer();
      server._meshApp = meshServer(new ServiceManager, null, {
        db: {
          connector: PostgreSQL,
          url: postgresUrl.format()
        }
      });
      server.getMeshApp = function() {
        return server._meshApp;
      };

      var driver = new BluemixDriver({
        baseDir: baseDir,
        server: server,
        WebsocketRouter: MockWsRouter,
        Container: MockContainer,
        config: nconf,
      });

      mkdirp(baseDir, function(err) {
        t.ifError(err);
        server._meshApp.dataSources.db.automigrate(function(err) {
          t.ifError(err);
          runTest(t, baseDir, nconf, server._meshApp, driver);
          t.end();
        });
      });

      t.on('end', cleanup);
    });
  });
};
