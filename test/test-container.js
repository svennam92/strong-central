var Container = require('../server/drivers/common/container');
var MockServer = require('./mock-central').MockServer;
var MockWsRouter = require('./mock-central').MockWsRouter;
var test = require('tap').test;

test('Test container', {timeout: 2000}, function(t) {
  var server = new MockServer();
  var router = new MockWsRouter();
  var container = null;


  t.test('create container', function(tt) {
    container = new Container({
      server: server,
      router: router,
      instanceId: '1',
      env: {foo: 'bar'},
      deploymentId: 'deployment-hash',
      token: 'container-token',
      startOptions: {},
    });
    tt.equal(container._client.getToken(), 'container-token',
      'Initial token is passed to channel');
    tt.equal(container.getToken(), 'container-token',
      'Generated token is stored in container');
    tt.equal(container.getId(), '1', 'Id value matches');
    tt.equal(container.getDeploymentId(), 'deployment-hash',
      'deployment matches');
    tt.deepEqual(container.getEnv(), {foo: 'bar'}, 'Env should match');
    tt.deepEqual(container.getStartOptions(), {}, 'No start opt should be set');
    tt.end();
  });


  t.test('set start options', function(tt) {
    tt.plan(5);
    container.on('start-options-updated', function(_c, cb) {
      tt.strictEqual(container, _c, 'Container should match');
      tt.deepEqual(container.getStartOptions(), {a: 1},
        'start opt should be set'
      );
      cb();
    });
    container.setStartOptions({a: 1}, function(err) {
      tt.ok(!err, 'set options should not error');
      container.removeAllListeners();
      container.on('start-options-updated', function() {
        tt.fail('listener should not be invoked.');
        tt.end();
      });
      container.setStartOptions({a: 1}, function(err) {
        container.removeAllListeners();
        tt.ok(!err, 'set options should not error');
        tt.deepEqual(container.getStartOptions(), {a: 1},
          'start opt should be set'
        );
      });
    });
  });


  t.test('set env', function(tt) {
    container.on('env-updated', function(_c, cb) {
      tt.strictEqual(container, _c, 'Container should match');
      tt.deepEqual(container.getEnv(), {foo: 'bar', bar: 'baz'},
        'env should be set');
      cb();
    });
    container.setEnv({foo: 'bar', bar: 'baz'}, function(err) {
      tt.ifError(err, 'set env should not error');
      container.removeAllListeners();
      container.on('env-updated', function() {
        tt.fail('env should not be update.');
        tt.end();
      });
      container.setEnv({foo: 'bar', bar: 'baz'}, function(err) {
        container.removeAllListeners();
        tt.ifError(err, 'set env should not error');
        tt.deepEqual(container.getEnv(), {foo: 'bar', bar: 'baz'},
          'env should be set'
        );
        tt.end();
      });
    });
  });


  t.test('set deployment id', function(tt) {
    tt.plan(5);
    container.on('deploy', function(_c, cb) {
      tt.strictEqual(container, _c, 'Container should match');
      tt.deepEqual(container.getDeploymentId(), 'deployment1',
        'deployment id should be set');
      cb();
    });
    container.deploy('deployment1', function(err) {
      tt.ok(!err, 'deployment should not error');
      container.removeAllListeners();
      container.on('deploy', function() {
        tt.fail('listener should not be invoked.');
        tt.end();
      });
      container.deploy('deployment1', function(err) {
        tt.ok(!err, 'deployment should not error');
        tt.deepEqual(container.getDeploymentId(), 'deployment1',
          'deployment id should be set'
        );
      });
    });
  });


  t.test('started message handling', function(tt) {
    container.removeAllListeners(); // cleanup from last test

    var started = {
      cmd: 'started',
      pid: 1234,
      pst: 12345
    };

    tt.plan(6);

    tt.false(container._hasStarted, 'initially not started');

    container.on('notification', function(id, req, cb) {
      tt.equal(id, '1', 'started container id');
      tt.match(req, started, 'started req');
      cb();
    });

    router.client.channel.onRequest(started, function() {
      tt.equal(container._hasStarted, true, 'started after notification');

      // Exit notification emited when new channel is received
      server.markOldProcessesStopped = function(instanceId, cb) {
        tt.equal(instanceId, '1', 'stop processes after new-channel');
        cb();
      };
      router.client.emit('new-channel', router.client.channel);
      tt.false(container._hasStarted, 'not started after new-channel');
      tt.end();
    });
  });


  t.test('notifications', function(tt) {
    container.removeAllListeners(); // cleanup from last test

    tt.plan(3);
    container.on('notification', function(instanceId, msg, cb) {
      tt.equal(instanceId, '1');
      tt.deepEqual(msg, {some: 'msg'});
      cb({reply: 'this one'});
    });
    router.channel.onRequest({some: 'msg'}, function(res) {
      tt.deepEqual(res, {reply: 'this one'});
    });
  });


  t.test('disconnect', function(tt) {
    var stopped = server.markOldProcessesStopped;
    var err;
    server.markOldProcessesStopped = function(id, cb) {
      tt.equal(container._id, id, 'processes stopped');
      return cb(err);
    };

    tt.plan(5);

    container.disconnect();
    container.disconnect();
    router.client.emit('new-channel', router.client.channel);
    container.disconnect();
    err = new Error('some lb error');
    container.disconnect();

    tt.on('end', function() {
      server.markOldProcessesStopped = stopped;
    });
  });


  t.end();
});
