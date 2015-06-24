var Driver = require('../server/drivers/executor');
var EventEmitter = require('events').EventEmitter;
var MockServer = require('./mock-central').MockServer;
var MockWsRouter = require('./mock-central').MockWsRouter;
var assert = require('assert');
var fs = require('fs');
var mkdirp = require('mkdirp');
var mktmpdir = require('mktmpdir');
var path = require('path');
var test = require('tap').test;
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

test('Test executor driver', function(t) {
  mktmpdir(function(err, dir, cleanup) {
    assert(!err);

    var baseDir = path.join(dir, 'base');
    var artifactDir = path.join(baseDir, 'artifacts');
    mkdirp(artifactDir, function(err) {
      assert(!err);

      runTest(t, baseDir, artifactDir);
      t.end();
    });

    t.on('end', cleanup);
  });
});

function runTest(t, baseDir, artifactDir) {
  var driver = null;
  var expectedArtifact =
    path.join(artifactDir, 'executor', 'commithash.tgz');

  t.test('create driver', function(tt) {
    driver = new Driver({
      baseDir: baseDir,
      artifactDir: artifactDir,
      server: new MockServer,
      WebsocketRouter: MockWsRouter,
      Container: MockContainer
    });
    driver.createExecutor('e1', 'executor-token', function(err) {
      tt.ifError(err);
      driver.createInstance('e1', 'i1', {}, '', function(err) {
        tt.ifError(err);
        tt.end();
      });
    });
  });

  t.test('prepare driver artifact', function(tt) {
    driver.prepareDriverArtifact({
      id: 'commithash',
      dir: path.join(__dirname, 'app')
    }, function(err) {
      tt.ifError(err, 'prepare artifacts should succeed');


      fs.stat(expectedArtifact, function(err, stat) {
        tt.ifError(err, 'artifact file should exist');
        tt.ok(stat.size > 0, 'artifact file should exist and have size > 0');
        tt.end();
      });
    });
  });

  t.test('retrieve driver artifact', function(tt) {
    var mockRequest = {
      get: function(header) {
        if (header === 'x-mesh-token')
          return 'executor-token';
        return '';
      }
    };

    var dumpFileDir = path.join(baseDir, 'dump');
    var dumpFile = path.join(dumpFileDir, 'dump.tgz');
    mkdirp(dumpFileDir, function() {
      var artifactFileStream = fs.createWriteStream(dumpFile);
      driver.getDriverArtifact(
        'i1', 'commithash', mockRequest, artifactFileStream);
      artifactFileStream.on('end', function() {
        var f1 = fs.statSync(expectedArtifact);
        var f2 = fs.statSync(dumpFile);
        tt.equal(f1.size, f2.size);
        tt.end();
      });
    });
  });
}
