'use strict';

var BaseDriver = require('../common/driver');
var Executor = require('./executor');
var debug = require('debug')('strong-central:driver:executor');
var fs = require('fs');
var fstream = require('fstream');
var mkdirp = require('mkdirp');
var path = require('path');
var tar = require('tar');
var util = require('util');
var zlib = require('zlib');

function ExecutorDriver(options) {
  BaseDriver.apply(this, arguments);
  this._Executor = options.Executor || Executor;
}
util.inherits(ExecutorDriver, BaseDriver);
ExecutorDriver.NAME = 'executor';
ExecutorDriver.SUPPORTS_BASIC_AUTH = true;
ExecutorDriver.REQUIRES_SCHEDULER = true;

function prepareDriverArtifact(commit, callback) {
  debug('Preparing commit %j', commit);
  var packageDir = path.join(this._artifactDir, 'executor');
  var packagePath = path.join(packageDir, commit.id + '.tgz');

  mkdirp(packageDir, function(err) {
    if (err) return callback(err);

    var commitDirStream = fstream.Reader({
      path: commit.dir,
      type: 'Directory',
      filter: function() {
        return !(this.parent && this.root === this.parent &&
               this.basename === '.git');
      },
    });
    var tarStream = commitDirStream.pipe(tar.Pack({
      noProprietary: true,
    }));
    var gzipStream = tarStream.pipe(zlib.createGzip());
    gzipStream.pipe(fs.createWriteStream(packagePath));

    tarStream.on('error', function(err) {
      if (callback) callback(err);
      callback = null;
    });
    gzipStream.on('error', function(err) {
      if (callback) callback(err);
      callback = null;
    });

    debug('Artifact saved: %s', packagePath);
    gzipStream.on('end', function() {
      if (callback) callback(null);
      callback = null;
    });
  });
}
ExecutorDriver.prototype.prepareDriverArtifact = prepareDriverArtifact;

function deploy(executorId, instanceId, deploymentId, callback) {
  var container = this._containerFor(executorId, instanceId);
  if (!container) return setImmediate(callback);

  container.deploy(deploymentId, callback);
}
ExecutorDriver.prototype.deploy = deploy;

function getDriverArtifact(instanceId, artifactId, req, res) {
  var reqToken = req.get('x-mesh-token');
  var executorId = null;
  var executor = null;

  debug('get artifact: instance %s token %s', instanceId, reqToken);
  debug('get artifact: %s', artifactId);

  for (var id in this._executors) {
    if (!this._executors.hasOwnProperty(id)) continue;
    if (reqToken === this._executors[id].getToken()) {
      executorId = id;
      executor = this._executors[id];
    }
  }

  if (!executor) {
    debug('Could not find executor x-mesh-token: %s', reqToken);
    res.status(401).send('Invalid executor credentials\n').end();
    return;
  }

  if (!this._containerFor(executorId, instanceId)) {
    debug('Invalid instance id %s', instanceId);
    res.status(401).send('Invalid executor credentials\n').end();
    return;
  }

  var packageDir = path.join(this._artifactDir, 'executor');
  var packagePath = path.join(packageDir, artifactId + '.tgz');
  fs.stat(packagePath, function(err) {
    if (err) {
      debug('Artifact not found %s', packagePath);
      res.status(404).send('Artifact not found\n').end();
      return;
    }

    var fStream = fs.createReadStream(packagePath);
    fStream.on('error', function(err) {
      debug('Error reading file %j', err);
      res.status(404).send('Artifact not found\n').end();
    });

    fStream.pipe(res);
  });
}
ExecutorDriver.prototype.getDriverArtifact = getDriverArtifact;

module.exports = ExecutorDriver;
