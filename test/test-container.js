var Container = require('../server/drivers/common/container');
var MockServer = require('./mock-central').MockServer;
var MockWsRouter = require('./mock-central').MockWsRouter;
var test = require('tap').test;

test('Test container', function(t) {
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
    setImmediate(tt.end.bind(tt));
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
      container.on('start-options-updated', function(_c, cb) {
        tt.fail('listener should not be invoked.');
        cb();
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
      tt.ok(!err, 'set env should not error');
      container.removeAllListeners();
      container.on('env-updated', function(_c, cb) {
        tt.fail('listener should not be invoked.');
        cb();
      });
      container.setEnv({foo: 'bar', bar: 'baz'}, function(err) {
        container.removeAllListeners();
        tt.ok(!err, 'set env should not error');
        tt.deepEqual(container.getEnv(), {foo: 'bar', bar: 'baz'},
          'env should be set'
        );
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
      container.on('deploy', function(_c, cb) {
        tt.fail('listener should not be invoked.');
        cb();
      });
      container.deploy('deployment1', function(err) {
        container.removeAllListeners();
        tt.ok(!err, 'deployment should not error');
        tt.deepEqual(container.getDeploymentId(), 'deployment1',
          'deployment id should be set'
        );
      });
    });
  });

  t.test('start-stop state and notifications', function(tt) {
    tt.plan(9);

    container.removeAllListeners();
    tt.equal(container._hasStarted, false, 'Container should not be started');
    server.onInstanceNotification = function(instanceId, msg, cb) {
      tt.equal(instanceId, '1', 'Instance 1 is expected');
      tt.equal(msg.cmd, 'started', 'Started command is expected');
      cb();
    };

    router.client.channel.onRequest({
      cmd: 'started',
      pid: 1234,
      pst: 12345
    }, function() {
      tt.equal(container._hasStarted, true, 'Container should be started');

      // Exit notification emited when new channel is recieved
      server.markOldProcessesStopped = function(instanceId, cb) {
        tt.equal(instanceId, '1', 'Instance 1 is expected');
        cb();
      };
      router.client.emit('new-channel', router.client.channel);
      tt.equal(container._hasStarted, false, 'Container should not be started');
    });
  });

  t.test('notifications', function(tt) {
    tt.plan(3);
    server.onInstanceNotification = function(instanceId, msg, cb) {
      tt.equal(instanceId, '1');
      tt.deepEqual(msg, {some: 'msg'});
      cb({reply: 'this one'});
    };
    router.channel.onRequest({some: 'msg'}, function(res) {
      tt.deepEqual(res, {reply: 'this one'});
    });
  });

  t.end();
});
