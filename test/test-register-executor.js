var Client = require('strong-mesh-models/client/client');
var MockExecutor = require('./mock-executor');
var createCentralAndTest = require('./helper').createCentralAndTest;

createCentralAndTest('register and connect executor',
  function(t, centralApp, centralUri) {
    centralUri.port = centralApp.port();
    var token;
    var exec;

    t.test('register executor via REST', function(tt) {
      var client = new Client(centralUri);
      client.executorCreate('some driver', function(err, exec) {
        tt.ifError(err, 'Executor should register without error');
        tt.ok(exec.id, 'Executor should have an id');
        tt.ok(exec.token, 'Executor should have a token');
        tt.equal(exec.driver, 'some driver');
        token = exec.token;
        tt.end();
      });
    });

    t.test('connect to central from executor', function(tt) {
      exec = new MockExecutor(
        centralUri,
        token,
        function onRequest(req, cb) {
          cb({});
        },
        function onConnected(executor) {
          tt.ok(executor.channel, 'Websocket channel should exist');
          tt.end();
        }
      );
      tt.ok(exec.channel, 'Comm channel should exist');
    });

    t.test('shutdown central', function(tt) {
      tt.plan(2);

      exec.channel.on('error', function(err) {
        tt.equal(err.message, 'disconnect');
      });

      centralApp.stop(function(err) {
        tt.ifError(err);
        tt.end();
      });
    });
  }
);
