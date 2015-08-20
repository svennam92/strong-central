'use strict';

var MeshServiceManager = require('strong-mesh-models').ServiceManager;
var async = require('async');
var centralVersion = require('../package.json').version;
var cicada = require('strong-fork-cicada');
var debug = require('debug')('strong-central:service-manager');
var extend = require('./util').extend;
var fmt = require('util').format;
var packReceiver = require('./pack-receiver');
var path = require('path');
var prepareCommit = require('./prepare').prepare;
var util = require('util');
var versionApi = require('strong-mesh-models/package.json').apiVersion;
var _ = require('lodash');

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

function onExecutorDestroy(executor, callback) {
  debug('onExecutorDestroy(%j)', executor);
  var self = this;

  executor.instances(function(err, instances) {
    if (err) return callback(err);
    async.each(instances, self._cleanupInstance.bind(self), function(err) {
      if (err) return callback(err);
      return self._server.destroyExecutor(executor.id, callback);
    });
  });
}
ServiceManager.prototype.onExecutorDestroy = onExecutorDestroy;

function updateExecutorData(id, hostname, addr, capacity, metadata, callback) {
  var models = this._meshApp.models;
  var Executor = models.Executor;

  Executor.findById(id, function(err, exec) {
    if (err) callback(err);

    exec.hostname = hostname;
    exec.address = addr;
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
    serverName: 'strong-central',
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
        {where: {executorId: executor.id, serverServiceId: service.id}},
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
          env: _.assign(instance.env, {STRONGLOOP_TRACES_ID: instance.id}),
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
  var self = this;

  service.instances(function(err, instances) {
    if (err) return callback(err);
    async.each(instances, self._cleanupInstance.bind(self), callback);
  });
}
ServiceManager.prototype.onServiceDestroy = onServiceDestroy;

function _cleanupInstance(instance, callback) {
  var models = this._meshApp.models;
  instance.processes(function(err, processes) {
    if (err) return callback(err);
    async.each(processes, cleanupProcess, function(err) {
      if (err) return callback(err);
      instance.destroy(callback);
    });
  });

  function cleanupProcess(proc, callback) {
    var Metric = models.ServiceMetric;
    var Profile = models.ProfileData;
    var ExpressRec = models.ExpressUsageRecord;
    var AgentTrace = models.AgentTrace;
    async.series([
      Metric.destroyAll.bind(Metric, {processId: proc.id}),
      Profile.destroyAll.bind(Profile, {serviceProcessId: proc.id}),
      ExpressRec.destroyAll.bind(ExpressRec, {processId: proc.id}),
      AgentTrace.destroyAll.bind(AgentTrace, {processId: proc.id}),
    ], function(err) {
      if (err) return callback(err);
      proc.destroy(callback);
    });
  }
}
ServiceManager.prototype._cleanupInstance = _cleanupInstance;

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
    commit.env = extend({}, service.env);

    prepareCommit(commit, function(err) {
      if (err) return console.error('Unable to prepare commit');
      self._server.prepareDriverArtifacts(commit, function(err) {
        if (err) return console.error('Unable to prepare driver artifact');

        service.updateAttributes({
          deploymentInfo: {id: commit.id}
        }, function(err) {
          if (err) {
            console.error('Error while updating deployment info: %j', err);
            return;
          }
        });
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

  return instance.serverService(function(err, service) {
    if (err) return callback(err);
    if (!service) return callback(Error(fmt(
        'Invalid instance %s: service %s not found',
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
  this._server.destroyInstance(instance.executorId, instance.id, callback);
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

function markOldProcessesStopped(instanceId, callback) {
  var models = this._meshApp.models;
  var Instance = models.ServiceInstance;
  var Process = models.ServiceProcess;

  Instance.findById(instanceId, function(err, instance) {
    if (err) return callback(err);

    instance.processes({where: {stopReason: ''}}, function(err, processes) {
      if (err) return callback(err);
      async.each(processes, function(proc, callback) {
        Process.recordExit(instanceId, {
          pid: proc.pid,
          wid: proc.workerId,
          pst: +proc.startTime,
          reason: 'Disconnected from Central server',
          suicide: false,
        }, callback);
      }, callback);
    });
  });
}
ServiceManager.prototype.markOldProcessesStopped = markOldProcessesStopped;

function onCtlRequest(service, instance, req, callback) {
  debug('onCtlRequest(%j, %j, %j)', service, instance, req);
  this._server.instanceRequest(instance.executorId, instance.id, req, callback);
}
ServiceManager.prototype.onCtlRequest = onCtlRequest;

function getGatewayInfos(callback) {
  this._meshApp.models.Gateway.find(function(err, gateways) {
    if (err) return callback(err);

    async.map(gateways, function(gw, callback) {
      callback(null, {id: gw.id, token: gw.token});
    }, callback);
  });
}
ServiceManager.prototype.getGatewayInfos = getGatewayInfos;

function onGatewayUpdate(gateway, isNew, callback) {
  debug('onGatewayUpdate(%j, %s)', gateway, isNew);
  if (isNew) {
    return this._server.createGateway(gateway.id, function(err, data) {
      if (err) return callback(err);
      gateway.token = data.token;
      gateway.save(callback);
    });
  }
  setImmediate(callback);
}
ServiceManager.prototype.onGatewayUpdate = onGatewayUpdate;

function onGatewayDestroy(gateway, callback) {
  debug('onGatewayDestroy(%j)', gateway);
  this._server.destroyGateway(gateway.id, callback);
}
ServiceManager.prototype.onGatewayDestroy = onGatewayDestroy;

function onGatewayConnect(gatewayId, callback) {
  debug('onGatewayConnect(%s)', gatewayId);
  var Service = this._meshApp.models.ServerService;
  var self = this;

  Service.find({}, function(err, services) {
    if (err) return callback(err);
    async.map(services, self._getServiceEndpointInfo.bind(self),
      function(err, serviceEndpoints) {
        if (err) return callback(err);
        self._server.updateGateway(gatewayId, serviceEndpoints, callback);
      }
    );
  });
}
ServiceManager.prototype.onGatewayConnect = onGatewayConnect;

function onProcessListen(proc, callback) {
  debug('onProcessListen(%j)', proc);
  var self = this;
  if (!proc) console.trace();

  proc.serviceInstance(function(err, instance) {
    if (err) return callback(err);
    instance.serverService(function(err, service) {
      if (err) return callback(err);
      self._getServiceEndpointInfo(service, function(err, endpointInfo) {
        if (err) return callback(err);
        self._server.updateGateways(endpointInfo, callback);
      });
    });
  });
}
ServiceManager.prototype.onProcessListen = onProcessListen;

function onProcessExit(proc, callback) {
  debug('onProcessExit(%j)', proc);
  this.onProcessListen(proc, callback);
}
ServiceManager.prototype.onProcessExit = onProcessExit;

function _getServiceEndpointInfo(service, callback) {
  service.executors(function(err, executors) {
    if (err) return callback(err);
    async.map(executors, getExecutorInstanceEndpoints, function(err, eps) {
      if (err) return callback(err);
      var endpoints = _(eps).flattenDeep().uniq().map(function(ep) {
        ep = ep.split(':');
        return {
          host: ep[0],
          port: ep[1],
          serviceId: service.id,
        };
      });
      callback(null, {serviceId: service.id, endpoints: endpoints.value()});
    });

    function getExecutorInstanceEndpoints(executor, callback) {
      executor.instances({where: {serverServiceId: service.id}},
        function(err, instances) {
          if (err) return callback(err);
          async.map(instances, getInstanceEndpoints, callback);
        }
      );

      function getInstanceEndpoints(instance, callback) {
        instance.processes({where: {stopReason: ''}}, function(err, processes) {
          if (err) return callback(err);
          // Get flattened/unique list of listening endpoints for the instance
          var endpoints = _(processes).map('listeningSockets').flatten().uniq();

          // Remap the endpoints with the executors routable addr
          endpoints = endpoints.map(function(e) {
            return executor.address + ':' + e.port;
          });

          callback(null, endpoints.value());
        });
      }
    }
  });
}
ServiceManager.prototype._getServiceEndpointInfo = _getServiceEndpointInfo;
