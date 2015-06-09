var test = require('tap').test;
var Container = require('../server/drivers/common/container');

function MockServer() {

}

function MockWsRouter() {
  this.args = arguments;
  this.channel = null;

  this.createChannel = function() {
    this.channel = Object.create(MockWsChannel);
    MockWsChannel.apply(this.channel, arguments);
    return this.channel;
  };
}

function MockWsChannel() {
  this.args = arguments;
  this.getToken = function() {
    return 'token from channel';
  };

  return this;
}

test('Test container', function(t) {
  var server = new MockServer();
  var router = new MockWsRouter();
  var container = null;

  t.test('create container', function(tt) {
    container = new Container(server, router, '1', {foo: 'bar'}, 'token token');
    tt.equal(router.channel.args[1], 'token token',
      'Initial token is passed to channel');
    tt.equal(container.getToken(), 'token from channel',
      'Generated token is stored in container');
    tt.equal(container.getId(), '1', 'Id value matches');
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
        tt.end();
      });
    });
  });

  t.test('set env', function(tt) {
    tt.plan(5);
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
        tt.end();
      });
    });
  });

  t.test('notifications', function(tt) {
    tt.plan(3);
    server.onInstanceNotification = function(instanceId, msg, cb) {
      tt.equal(instanceId, '1');
      tt.deepEqual(msg, {some: 'msg'});
      cb({reply: 'this one'});
    };
    router.channel.args[0]({some: 'msg'}, function(res) {
      tt.deepEqual(res, {reply: 'this one'});
      tt.end();
    });
  });

  t.end();
});
