var Client = require('strong-mesh-models/client/client');
var createCentralAndTest = require('./test-helper').createCentralAndTest;

createCentralAndTest('register and connect executor',
  function(t, centralApp, centralUri) {
    var client = new Client(centralUri);

    t.test('register executor 1 via REST', function(tt) {
      client.executorCreate(null, function(err, exec) {
        tt.ok(!err, 'Executor should register without error');
        tt.ok(exec.id, 'Executor should have an id');
        tt.ok(exec.token, 'Executor should have a token');
        tt.equal(exec.driver, 'executor');
        tt.end();
      });
    });

    t.test('register executor 2 via REST', function(tt) {
      client.executorCreate(null, function(err, exec) {
        tt.ok(!err, 'Executor should register without error');
        tt.ok(exec.id, 'Executor should have an id');
        tt.ok(exec.token, 'Executor should have a token');
        tt.equal(exec.driver, 'executor');
        tt.end();
      });
    });

    t.test('create a service', function(tt) {
      client.serviceCreate('foo', 0, function(err) {
        tt.ok(!err, 'Service should create without error');
        tt.end();
      });
    });

    t.test('ensure that instances were created', function(tt) {
      var ServiceInstance = centralApp._meshApp.models.ServiceInstance;
      ServiceInstance.find({}, function(err, instances) {
        tt.ok(!err);
        tt.equal(instances.length, 2, '2 instances should be created');
        tt.notEqual(instances[0].executorId,
          instances[1].executorId,
          'Instances should be on different executors');
        tt.end();
      });
    });

    t.test('shutdown central', function(tt) {
      centralApp.stop(function() {
        tt.end();
      });
    });

    t.end();
  }
);
