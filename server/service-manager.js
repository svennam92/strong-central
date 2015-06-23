'use strict';

var MeshServiceManager = require('strong-mesh-models').ServiceManager;
var async = require('async');
var cicada = require('strong-fork-cicada');
var centralVersion = require('../package.json').version;
var debug = require('debug')('strong-pm:service-manager');
var fmt = require('util').format;
var packReceiver = require('./pack-receiver');
var path = require('path');
var util = require('util');
var versionApi = require('strong-mesh-models/package.json').apiVersion;

module.exports = ServiceManager;

function ServiceManager(server) {
  this._server = server;
  this._meshApp = null;
}

util.inherits(ServiceManager, MeshServiceManager);

function initEnv(meshApp, callback) {
  this._meshApp = meshApp;
  var models = meshApp.models;
  var Service = models.ServerService;

  var self = this;
  // Set the default environment for any new services that are created
  Service.definition.properties.env.default = function() {
    var env = self._server.getDefaultEnv();
    debug('get default env: %j', env);
    return env;
  };

  callback();
}
ServiceManager.prototype.initEnv = initEnv;

/**
 * Get a list of executors and their driver types
 *
 * @param {function} callback fn(err, [{ id, driver, metadata }])
 */
function getExecutorInfo(callback) {
  var models = this._meshApp.models;
  var Executor = models.Executor;

  Executor.find({isAlive: true}, function(err, executors) {
    if (err) callback(err);

    async.map(executors, function(e, callback) {
      callback(null, {
        id: e.id,
        driver: e.driver,
        metadata: e.metadata,
        token: e.token
      });
    }, callback);
  });
}
ServiceManager.prototype.getExecutorInfo = getExecutorInfo;

/**
 * Get a list of all instances on an executor
 *
 * @param {string} executorId Id of the executor
 * @param {function} callback fn(err, [{id, metadata}])
 */
function getInstanceInfo(executorId, callback) {
  var models = this._meshApp.models;
  var Instance = models.ServiceInstance;

  Instance.find({where: {executorId: executorId}}, function(err, instances) {
    if (err) callback(err);

    async.map(instances, function(i, callback) {
      callback(null, {
        id: i.id,
        metadata: i.containerVersionInfo,
        token: i.token,
        deploymentId: i.currentDeploymentId,
      });
    }, callback);
  });
}
ServiceManager.prototype.getInstanceInfo = getInstanceInfo;

function onExecutorUpdate(executor, isNew, callback) {
  var self = this;

  debug('onExecutorUpdate(%j, %s)', executor, isNew);
  if (isNew) {
    return this._server.createExecutor(executor.id, function(err, _, data) {
      if (err) return callback(err);
      executor.metadata = data.metadata;
      executor.token = data.token;
      executor.save(function(err) {
        if (err) return callback(err);
        self._rescheduleAll(callback);
      });
    });
  }
  setImmediate(callback);
}
ServiceManager.prototype.onExecutorUpdate = onExecutorUpdate;

function onExecutorRequest(id, req, callback) {
  debug('onExecutorRequest(%j, %s)', id, req);
  return this._server.onExecutorRequest(id, req, callback);
}
ServiceManager.prototype.onExecutorRequest = onExecutorRequest;

function updateExecutorData(id, hostname, ip, capacity, metadata, callback) {
  var models = this._meshApp.models;
  var Executor = models.Executor;

  Executor.findById(id, function(err, exec) {
    if (err) callback(err);

    exec.hostname = hostname;
    exec.address = ip;
    exec.totalCapacity = capacity;
    for (var i in metadata) {
      exec.metadata[i] = metadata[i];
    }
    exec.save(function(err) {
      callback(err);
    });
  });
}
ServiceManager.prototype.updateExecutorData = updateExecutorData;

function updateInstanceMetadata(id, metadata, callback) {
  var models = this._meshApp.models;
  var Instance = models.ServiceInstance;
  Instance.findById(id, function(err, exec) {
    if (err) return callback(err);

    exec.metadata = metadata;
    exec.save(callback);
  });
}
ServiceManager.prototype.updateInstanceMetadata = updateInstanceMetadata;

function getApiVersionInfo(callback) {
  var models = this._meshApp.models;
  callback(null, new models.Api({
    version: centralVersion,
    serverPid: process.pid,
    apiVersion: versionApi,
    apiPort: this._server.port(),
  }));
}
ServiceManager.prototype.getApiVersionInfo = getApiVersionInfo;

/**
 * This is the function that creates and assigns instances on executors for any
 * new or updated services.
 *
 * @param {ServerService} service being updated
 * @param {boolean} isNew true if this is a new service
 * @param {function} callback fn(err)
 */
function onServiceUpdate(service, isNew, callback) {
  this._schedule(service, callback);
}
ServiceManager.prototype.onServiceUpdate = onServiceUpdate;

function _rescheduleAll(callback) {
  var models = this._meshApp.models;
  var self = this;

  models.ServerService.find(function(err, services) {
    if (err) return callback(err);

    async.each(services, self._schedule.bind(self), callback);
  });
}
ServiceManager.prototype._rescheduleAll = _rescheduleAll;

function _schedule(service, callback) {
  debug('onServiceUpdate(%j)', service);
  if (!service.deploymentInfo || !service.deploymentInfo.id) return callback();

  var self = this;

  debug('onServiceUpdate: svc %j env: %j', service.id, service.env);

  async.series([scheduleInstances, updateInstances], callback);

  // Instances are created before deploy/start so that additional paramaters
  // like cpus (# procs) or tracingEnabled etc can be specified before the
  // service deployment is started.

  // Dumb scheduling algo, creates 1 instance per executor. does not respect
  // scale or groups.
  function scheduleInstances(callback) {
    var models = self._meshApp.models;
    var Instance = models.ServiceInstance;
    var Executor = models.Executor;

    Executor.find({}, function(err, executors) {
      if (err) return callback(err);
      async.each(executors, ensureInstanceExists, callback);
    });

    function ensureInstanceExists(executor, callback) {
      Instance.findOne(
        {executorId: executor.id, serverServiceId: service.id},
        function(err, inst) {
          if (err) return callback(err);
          if (inst) return callback(null, inst);

          inst = new Instance({
            executorId: executor.id,
            serverServiceId: service.id,
            groupId: 1,
            cpus: 'STRONGLOOP_CLUSTER' in process.env ?
              process.env.STRONGLOOP_CLUSTER : 'CPU',

            // allow starting tracing on all instances via env
            // for testing purposes
            tracingEnabled: !!process.env.STRONGLOOP_TRACING || false,
            currentDeploymentId: service.deploymentInfo.id,
          });
          inst.save(callback);
        }
      );
    }
  }

  function updateInstances(callback) {
    var env = service.env;

    service.instances(true, function(err, instances) {
      if (err) return callback(err);

      async.each(instances, updateInstance, callback);

      function updateInstance(instance, callback) {
        instance.updateAttributes({
          currentDeploymentId: service.deploymentInfo.id,
        }, function(err) {
          if (err) return callback(err);

          self._server.updateInstanceEnv(
            instance.executorId, instance.id, env, callback
          );
        });
      }
    });
  }
}
ServiceManager.prototype._schedule = _schedule;

function onServiceDestroy(service, callback) {
  debug('onServiceDestroy(%j)', service);
  setImmediate(callback);
}
ServiceManager.prototype.onServiceDestroy = onServiceDestroy;

function onDeployment(service, req, res) {
  debug('onDeployment(%j)', service);
  var svcDir = path.resolve(
    this._server.getBaseDir(), 'svc', String(service.id)
  );
  var git = cicada(svcDir);
  var self = this;

  git.on('commit', function(commit) {
    // Errors that occur within this block cannot be reported back on the deploy
    // request because cicada/tar deploy handled and closes it before this event
    // is emitted.

    debug('commit %j for service %s', commit, service.id);

    debug('preparing service %s', service);

    self._server.prepareDriverArtifacts(commit, function(err) {
      if (err) return console.error('Unable to prepare driver artifact');

      service.updateAttributes({
        deploymentInfo: {id: commit.id}
      }, function(err, service) {
        if (err) {
          console.error('Error while updating deployment info: %j', err);
          return;
        }
      });
    });
  });

  if (req.method === 'PUT') {
    debug('deploy accepted: npm package');
    var tar = packReceiver(git);
    return tar.handle(req, res);
  }

  debug('deploy accepted: git deploy');
  return git.handle(req, res);
}
ServiceManager.prototype.onDeployment = onDeployment;

function onInstanceUpdate(instance, isNew, callback) {
  debug('onInstanceUpdate(%j, %s)', instance, isNew);
  var server = this._server;
  var instId = instance.id;
  var execId = instance.executorId;
  var models = this._meshApp.models;
  var Service = models.ServerService;

  return Service.findById(instance.serverServiceId, function(err, service) {
    if (err) return callback(err);
    if (!service) return callback(Error(fmt(
        'Invalid instance %s: service %snot found',
        instance.id, instance.serverServiceId))
    );

    if (isNew) {
      return server.createInstance({
          executorId: execId,
          instanceId: instId,
          env: service.env,
          token: null,
          startOptions: {
            size: instance.cpus,
            trace: instance.tracingEnabled,
          },
          deploymentId: instance.currentDeploymentId
        }, function(err, data) {
          if (err) return callback(err);
          instance.updateAttributes({token: data.token}, callback);
        }
      );
    }

    var tasks = [];
    if (instance.cpus != null) {
      tasks.push(server.setInstanceOptions.bind(
        server, execId, instId, {size: instance.cpus}
      ));
    }
    tasks.push(server.setInstanceOptions.bind(
      server, execId, instId, {trace: instance.tracingEnabled}
    ));
    tasks.push(server.updateInstanceEnv.bind(
      server, execId, instId, service.env
    ));
    tasks.push(server.deploy.bind(
      server, execId, instId, instance.currentDeploymentId
    ));
    async.series(tasks, callback);
  });
}
ServiceManager.prototype.onInstanceUpdate = onInstanceUpdate;

function onInstanceDestroy(instance, callback) {
  debug('onInstanceDestroy(%j)', instance);
  setImmediate(callback);
}
ServiceManager.prototype.onInstanceDestroy = onInstanceDestroy;

function setInstanceMetadata(instanceId, data, callback) {
  var models = this._meshApp.models;
  var Instance = models.ServiceInstance;

  Instance.findById(instanceId, function(err, instance) {
    if (err) return callback(err);
    if (!instance) return callback(Error('Invalid instance id'));

    var mdata = instance.containerVersionInfo || {};
    for (var k in data) {
      mdata[k] = data[k];
    }
    instance.updateAttributes({containerVersionInfo: mdata}, callback);
  });
}
ServiceManager.prototype.setInstanceMetadata = setInstanceMetadata;
