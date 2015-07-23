var Client = require('strong-mesh-models/client/client');
var async = require('async');
var createCentralAndTest = require('./helper').createCentralAndTest;

createCentralAndTest('register and connect executor',
  function(t, centralApp, centralUri) {
    var client = new Client(centralUri);
    var models = centralApp._meshApp.models;
    var AgentTrace = models.AgentTrace;
    var ExpressUsageRecord = models.ExpressUsageRecord;
    var Instance = models.ServiceInstance;
    var ServiceMetric = models.ServiceMetric;
    var ServiceProcess = models.ServiceProcess;

    var exec1Id = null;
    var exec2Id = null;
    var exec3Id = null;

    t.test('register executor 1 via REST', function(tt) {
      client.executorCreate(null, function(err, exec) {
        tt.ok(!err, 'Executor should register without error');
        tt.ok(exec.id, 'Executor should have an id');
        tt.ok(exec.token, 'Executor should have a token');
        tt.equal(exec.driver, 'executor');
        exec1Id = exec.id;
        tt.end();
      });
    });

    t.test('create service foo', function(tt) {
      client.serviceCreate('foo', 0, function(err, service) {
        tt.ifError(err, 'Service should create without error');
        service.updateAttributes({
          deploymentInfo: {id: 'some commit'}
        }, function(err) {
          tt.ifError(err, 'Service should update without error');
          tt.end();
        });
      });
    });

    t.test('ensure that 1 instances exist for exec 1', function(tt) {
      ensureInstance(tt, exec1Id, 1);
    });

    t.test('register executor 2 via REST', function(tt) {
      client.executorCreate(null, function(err, exec) {
        tt.ok(!err, 'Executor should register without error');
        tt.ok(exec.id, 'Executor should have an id');
        tt.ok(exec.token, 'Executor should have a token');
        tt.equal(exec.driver, 'executor');
        exec2Id = exec.id;
        tt.end();
      });
    });

    t.test('ensure that 1 instances exist for exec 2', function(tt) {
      ensureInstance(tt, exec2Id, 1);
    });

    t.test('populate some metrics and processes for exec 1', function(tt) {
      populateMetrics(tt, exec1Id);
    });

    t.test('destroy exec 1', function(tt) {
      client.executorDestroy(exec1Id, function(err) {
        tt.ifError(err);
        tt.end();
      });
    });

    t.test('ensure that 1 instances are destroyed', function(tt) {
      ensureInstance(tt, exec1Id, 0);
    });

    t.test('ensure that models related to exec 1 are destroyed', function(tt) {
      async.series([
        ensureNoneExist.bind(null, ServiceMetric),
        ensureNoneExist.bind(null, ServiceProcess),
        ensureNoneExist.bind(null, ExpressUsageRecord),
        ensureNoneExist.bind(null, AgentTrace),
      ], function(err) {
        tt.ifError(err);
        tt.end();
      });

      function ensureNoneExist(model, callback) {
        model.find(function(err, modelInstances) {
          if (err) return callback(err);
          tt.equal(modelInstances.length, 0,
            'No instances of ' + model.modelName + ' should exist');
          callback();
        });
      }
    });

    t.test('register executor 3 via REST', function(tt) {
      client.executorCreate(null, function(err, exec) {
        tt.ok(!err, 'Executor should register without error');
        tt.ok(exec.id, 'Executor should have an id');
        tt.ok(exec.token, 'Executor should have a token');
        tt.equal(exec.driver, 'executor');
        exec3Id = exec.id;
        tt.end();
      });
    });

    t.test('ensure that 1 instances exist for exec 3', function(tt) {
      ensureInstance(tt, exec3Id, 1);
    });

    t.test('populate some metrics and processes for exec 3', function(tt) {
      populateMetrics(tt, exec3Id);
    });

    t.test('create service bar', function(tt) {
      client.serviceCreate('bar', 0, function(err, service) {
        tt.ifError(err, 'Service should create without error');
        service.updateAttributes({
          deploymentInfo: {id: 'some commit'}
        }, function(err) {
          tt.ifError(err, 'Service should update without error');
          tt.end();
        });
      });
    });

    t.test('ensure that 2 instances exist for exec 2', function(tt) {
      ensureInstance(tt, exec3Id, 2);
    });

    t.test('ensure that 2 instances exist for exec 3', function(tt) {
      ensureInstance(tt, exec3Id, 2);
    });

    t.test('destroy service foo', function(tt) {
      client.serviceDestroy('foo', function(err) {
        tt.ifError(err, 'Service should be destroyed without error');
        tt.end();
      });
    });

    t.test('ensure that 1 instances exist for exec 2', function(tt) {
      ensureInstance(tt, exec3Id, 1);
    });

    t.test('ensure that 1 instances exist for exec 3', function(tt) {
      ensureInstance(tt, exec3Id, 1);
    });

    t.test('ensure that models related to exec 2 service foo are destroyed',
      function(tt) {
        async.series([
          ensureNoneExist.bind(null, ServiceMetric),
          ensureNoneExist.bind(null, ServiceProcess),
          ensureNoneExist.bind(null, ExpressUsageRecord),
          ensureNoneExist.bind(null, AgentTrace),
        ], function(err) {
          tt.ifError(err);
          tt.end();
        });

        function ensureNoneExist(model, callback) {
          model.find(function(err, modelInstances) {
            if (err) return callback(err);
            tt.equal(modelInstances.length, 0,
              'No instances of ' + model.modelName + ' should exist');
            callback();
          });
        }
      }
    );

    t.test('shutdown central', function(tt) {
      centralApp.stop(function() {
        tt.end();
      });
    });

    t.end();

    function populateMetrics(tt, execId) {
      Instance.findOne({executorId: execId}, function(err, instance) {
        tt.ifError(err);
        async.each([0, 1, 2, 3], function(wid, callback) {
          instance.processes.create({
            parentPid: wid !== 0 ? 123 : 0,
            pid: 123 + wid,
            workerId: wid,
            startTime: Date.now(),
          }, function(err, proc) {
            tt.ifError(err);
            createProcessMetrics(proc, callback);
          });
        }, function(err) {
          tt.ifError(err);
          tt.end();
        });
      });

      function createProcessMetrics(proc, callback) {
        async.series([
          createMetrics.bind(null, proc, ServiceMetric),
          createMetrics.bind(null, proc, ExpressUsageRecord),
          createMetrics.bind(null, proc, AgentTrace),
        ], callback);
      }

      function createMetrics(proc, model, callback) {
        async.each([1, 2, 3, 4], function(_, callback) {
          model.create({
            processId: proc.id,
            workerId: proc.workerId,
            timeStamp: Date.now()
          }, callback);
        }, callback);
      }
    }

    function ensureInstance(tt, execId, num) {
      var ServiceInstance = centralApp._meshApp.models.ServiceInstance;
      ServiceInstance.find({where: {executorId: execId}},
        function(err, instances) {
          tt.ok(!err);
          tt.equal(instances.length, num, num + ' instance should exist');
          tt.end();
        }
      );
    }
  }
);
