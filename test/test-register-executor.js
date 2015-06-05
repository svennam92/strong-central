var Client = require('strong-mesh-models/client/client');
var MockExecutor = require('./mock-executor');
var createCentralAndTest = require('./test-helper').createCentralAndTest;

createCentralAndTest('register and connect executor',
  function(t, centralApp, centralUri) {
    centralUri.port = centralApp.port();
    var token = null;

    t.test('register executor via REST', function(tt) {
      var client = new Client(centralUri);
      client.executorCreate('some driver', function(err, exec) {
        tt.ok(!err, 'Executor should register without error');
        tt.ok(exec.id, 'Executor should have an id');
        tt.ok(exec.token, 'Executor should have a token');
        tt.equal(exec.driver, 'some driver');
        token = exec.token;
        tt.end();
      });
    });

    t.test('connect to central from executor', function(tt) {
      var exec = new MockExecutor(
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
      centralApp.stop(function() {
        tt.end();
      });
    });

    t.end();
  }
);
