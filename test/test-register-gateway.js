var Client = require('strong-mesh-models/client/client');
var MockGateway = require('./mock-gateway');
var createCentralAndTest = require('./helper').createCentralAndTest;

createCentralAndTest('register and connect gateway',
  function(t, centralApp, centralUri, callback) {
    var token;
    var gw;

    t.test('register gateway via REST', function(tt) {
      var client = new Client(centralUri);
      client.gatewayCreate(function(err, gw) {
        tt.ok(!err, 'Gateway should register without error');
        tt.ok(gw.id, 'Gateway should have an id');
        tt.ok(gw.token, 'Gateway should have a token');
        token = gw.token;
        tt.end();
      });
    });

    t.test('connect to central from gateway', function(tt) {
      gw = new MockGateway(
        centralUri,
        token,
        function onRequest(req, cb) {
          cb({});
        },
        function onConnected(gateway) {
          tt.ok(gateway.channel, 'Websocket channel should exist');
          tt.end();
        }
      );
      tt.ok(gw.channel, 'Comm channel should exist');
    });

    t.test('shutdown central', function(tt) {
      tt.plan(2);

      gw.channel.on('error', function(err) {
        tt.equal(err.message, 'disconnect');
      });

      centralApp.stop(function(err) {
        tt.ifError(err);
        tt.end();
        callback();
      });
    });
  }
);
