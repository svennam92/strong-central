var Executor = require('./executor');
var WebsocketRouter = require('strong-control-channel/ws-router');
var async = require('async');
var debug = require('debug')('strong-central:driver:executor');
var fs = require('fs');
var fstream = require('fstream');
var mkdirp = require('mkdirp');
var path = require('path');
var tar = require('tar');
var zlib = require('zlib');

function ExecutorDriver(options) {
  this._baseDir = options.baseDir;
  this._server = options.server;
  this._artifactDir = options.artifactDir;
  this._WebsocketRouter = options.WebsocketRouter || WebsocketRouter;
  this._Container = options.Container;
  this._Executor = options.Executor || Executor;

  this._router = new this._WebsocketRouter(
    this._server.getHttpServer(),
    this._server.getBaseApp(),
    'executor-control'
  );
  this._instRouter = new this._WebsocketRouter(
    this._server.getHttpServer(),
    this._server.getBaseApp(),
    'supervisor-control'
  );

  this._executors = {};
}

/**
 * Recreate channels for existing executors/instances. Updates executor and
 * instance metadata values. (Possibly not needed in initial stages)
 *
 * @param {object} execInfo {id, metadata}
 * @param {array} instanceInfos [{id, metadata}]
 * @param {function} callback fn(err)
 */
function reconnect(execInfo, instanceInfos, callback) {
  debug('reconnect executor: %j', execInfo);
  this.createExecutor(
    execInfo.id, execInfo.token, function(err, executor) {
      if (err) return callback(err);

      async.each(instanceInfos, connectInstance, callback);

      function connectInstance(instInfo, callback) {
        debug('with instance: %j', instInfo);

        // FIXME @kraman, instances can exist with currentDeploymentId of '',
        // I'm guarding here for the moment, because it seems from the
        // comments in service-manager that that is allowed, but such an
        // instance is undeployable.
        if (!instInfo.deploymentId) {
          console.error('Undeployable executor %d instance: %j',
            execInfo.id, instInfo);
          return callback();
        }

        executor.createInstance({
          instanceId: instInfo.id,
          env: instInfo.env,
          deploymentId: instInfo.deploymentId,
          token: instInfo.token,
          startOptions: {}, // FIXME
        }, callback);
      }
    }
  );
}
ExecutorDriver.prototype.reconnect = reconnect;

/**
 * Create a new executor connection
 *
 * @param {string} execId ID of the new executor
 * @param {string} [token] Authentication token. If null, a new token will be
 * generated.
 * @param {function} callback fn(err, execMetadata)
 */
function createExecutor(execId, token, callback) {
  if (typeof token === 'function') {
    callback = token;
    token = null;
  }

  var executor = this._executors[execId] = new this._Executor({
    server: this._server,
    execRouter: this._router,
    instanceRouter: this._instRouter,
    executorId: execId,
    token: token,
    Container: this._Container,
  });
  executor.connect(callback);
}
ExecutorDriver.prototype.createExecutor = createExecutor;

/**
 * Shutdown the driver and all its connections. Does not shutdown the executors.
 * @param {function} callback fn(err)
 */
function stop(callback) {
  var self = this;

  async.each(Object.keys(self._executors), function(execId, callback) {
    self._executors[execId].close(callback);
  }, callback);
}
ExecutorDriver.prototype.stop = stop;

/**
 * @param {object} options
 * @param {string} options.executorId
 * @param {string} options.instanceId
 * @param {object} options.instEnv
 * @param {string} options.token auth token for instance if available. Will be
 * generated if not provided
 * @param {object} options.startOptions
 * @param {function} callback
 */
function createInstance(options, callback) {
  //
  //executorId, instanceId, env, deploymentId, callback) {
  this._executors[options.executorId].createInstance(options, callback);
  //  instanceId, env, deploymentId, null, callback
  //);
}
ExecutorDriver.prototype.createInstance = createInstance;

function onExecutorRequest(executorId, req, callback) {
  this._executors[executorId].onRequest(req, callback);
}
ExecutorDriver.prototype.onExecutorRequest = onExecutorRequest;

function updateInstanceEnv(executorId, instanceId, env, callback) {
  this._containerFor(executorId, instanceId).setEnv(env, callback);
}
ExecutorDriver.prototype.updateInstanceEnv = updateInstanceEnv;

function setInstanceOptions(executorId, instanceId, options, callback) {
  this._containerFor(executorId, instanceId).setStartOptions(options, callback);
}
ExecutorDriver.prototype.setInstanceOptions = setInstanceOptions;

function _containerFor(executorId, instanceId) {
  return this._executors[executorId].containerFor(instanceId);
}
ExecutorDriver.prototype._containerFor = _containerFor;

function prepareDriverArtifact(commit, callback) {
  debug('Preparing commit %j', commit);
  var packageDir = path.join(this._artifactDir, 'executor');
  var packagePath = path.join(packageDir, commit.id + '.tgz');

  mkdirp(packageDir, function(err) {
    if (err) return callback(err);

    var commitDirStream = fstream.Reader({
      path: commit.dir,
      type: 'Directory'
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
  this._containerFor(executorId, instanceId).deploy(deploymentId, callback);
}
ExecutorDriver.prototype.deploy = deploy;

function getDriverArtifact(instanceId, artifactId, req, res) {
  var reqToken = req.get('x-mesh-token');
  var executorId = null;
  var executor = null;

  debug('get artifact: instance %s token %s', instanceId, reqToken);
  debug('get artifact: %s', artifactId);

  for (var id in this._executors) {
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
