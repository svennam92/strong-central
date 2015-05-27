'use strict';

var MeshServiceManager = require('strong-mesh-models').ServiceManager;
var async = require('async');
var centralVersion = require('../package.json').version;
var debug = require('debug')('strong-pm:service-manager');
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
      });
    }, callback);
  });
}
ServiceManager.prototype.getInstanceInfo = getInstanceInfo;

function onExecutorUpdate(executor, isNew, callback) {
  debug('onExecutorUpdate(%j, %s)', executor, isNew);
  if (isNew) {
    return this._server.createExecutor(executor.id, function(err, _, data) {
      if (err) return callback(err);
      executor.metadata = data.metadata;
      executor.token = data.token;
      executor.save(callback);
    });
  }
  setImmediate(callback);
}
ServiceManager.prototype.onExecutorUpdate = onExecutorUpdate;

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
  debug('onServiceUpdate(%j)', service);

  var self = this;

  debug('onServiceUpdate: svc %j env: %j', service.id, service.env);

  async.series([scheduleInstances, updateEnvironment], callback);

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
          });
          inst.save(callback);
        }
      );
    }
  }

  function updateEnvironment(callback) {
    var env = service.env;

    service.instances(true, function(err, instances) {
      if (err) return callback(err);

      debug('updateInstanceEnv: svc %j instances: %s',
        service.id, instances.map(function(i) {
          return i.id;
        }).join(', '));

      async.each(instances, updateInstanceEnv, callback);

      function updateInstanceEnv(instance, callback) {
        self._server.updateInstanceEnv(
          instance.executorId, instance.id, env, callback
        );
      }
    });
  }
}
ServiceManager.prototype.onServiceUpdate = onServiceUpdate;

function onServiceDestroy(service, callback) {
  debug('onServiceDestroy(%j)', service);
  setImmediate(callback);
}
ServiceManager.prototype.onServiceDestroy = onServiceDestroy;

function onDeployment(service, req, res) {
  debug('onDeployment(%j)', service);
  res.end('hi');
}
ServiceManager.prototype.onDeployment = onDeployment;

function getDeployment(service, req, res) {
  debug('getDeployment(%j)', service);
  res.end('hi');
}
ServiceManager.prototype.getDeployment = getDeployment;

function onInstanceUpdate(instance, isNew, callback) {
  debug('onInstanceUpdate(%j, %s)', instance, isNew);
  var server = this._server;
  var instId = instance.id;
  var execId = instance.executorId;

  if (isNew) {
    return server.createInstance(
      execId, instId, {},
      function(err, data) {
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
  async.series(tasks, callback);
}
ServiceManager.prototype.onInstanceUpdate = onInstanceUpdate;

function onInstanceDestroy(instance, callback) {
  debug('onInstanceDestroy(%j)', instance);
  setImmediate(callback);
}
ServiceManager.prototype.onInstanceDestroy = onInstanceDestroy;
