var Executor = require('../server/drivers/executor/executor');
var MockWsRouter = require('./mock-central').MockWsRouter;
var MockServer = require('./mock-central').MockServer;
var debug = require('debug')('strong-central:test');
var tap = require('tap');

// Timeout to workaround https://github.com/isaacs/node-tap/issues/152
tap.test('executor', {timeout: 2000}, function(t) {
  var server = new MockServer;
  var router = new MockWsRouter();
  var container = {
    on: function() {
    },
    getDeploymentId: function() {
      return this.options.deploymentId;
    },
    getId: function() {
      return this.options.instanceId;
    },
    getEnv: function() {
      return this.options.env;
    },
    getStartOptions: function() {
      return this.options.startOptions;
    },
    getToken: function() {
      return this.options.token;
    },
    updateContainerMetadata: function(data, callback) {
      debug('updateContainerMetadata: %j', data);
      if (callback) return callback();
    },
  };

  function Container(options) {
    debug('Container: %j', options);
    container.options = options;
    return container;
  }

  var e = new Executor({
    server: server,
    executorRouter: router,
    instanceRouter: 'instance router',
    executorId: 'exec-id',
    Container: Container,
    token: 'exec-tok',
  });


  t.test('listen', function(t) {
    e.listen(function(err, _e, _o) {
      debug('listen cb: o %j', _o);
      t.ifError(err);
      t.equal(e, _e);
      t.match(_o.token, 'exec-tok');
      setImmediate(function() {
        // mock immediately emits new-channel after listen/acceptClient()
        t.equal(e._channel, router.client.channel);
        t.end();
      });
    });
  });


  t.test('exec start', function(t) {
    var starting = {
      cmd: 'starting',
      cpus: '3',
      hostname: 'exec-host',
      address: '1.2.3.4',
      driver: 'direct',
    };

    server.updateExecutorData =
      function(execId, host, address, cpus, meta, cb) {
        t.equal(execId, 'exec-id', 'update exec id');
        t.equal(host, starting.hostname);
        t.equal(address, starting.address);
        t.equal(cpus, starting.cpus);
        t.match(meta, {remoteDriver: starting.driver}, 'update exec meta');
        return cb();
      };

    t.on('end', function() {
      server.updateExecutorData = null;
    });

    t.plan(6);

    router.client.channel.onRequest({
      cmd: 'starting',
      cpus: '3',
      hostname: 'exec-host',
      address: '1.2.3.4',
      driver: 'direct',
    }, function(rsp) {
      t.equal(rsp.message, 'ok', 'starting ok');
    });
  });


  t.test('create instance', function(t) {
    router.client.channel.request = function(req, callback) {
      var deploy = {
        cmd: 'container-deploy',
        deploymentId: 'deploy-id',
        id: 'inst-id',
        options: {trace: true},
        token: 'inst-tok',
      };
      t.match(req, deploy, 'deploy');
      callback({message: 'ok'});
    };

    t.on('end', function() {
      router.client.channel.request = null;
    });


    t.plan(7);

    e.createInstance({
      instanceId: 'inst-id',
      deploymentId: 'deploy-id',
      startOptions: {
        trace: true
      },
      token: 'inst-tok',
    }, function(err, data) {
      var o = container.options;

      t.ifError(err, 'instance data');
      t.equal(data.token, 'inst-tok');
      t.equal(o.instanceId, 'inst-id');
      t.equal(o.deploymentId, 'deploy-id');
      t.equal(o.token, 'inst-tok');
    });
  });

  t.test('executor connection replaced', function(t) {
    t.plan(assertExecutorLost(t, 'executor-replaced'));
    // Shorten error stack with setImmediate
    setImmediate(function() {
      router.client.emit('new-channel', router.client.channel);
    });
  });

  t.test('executor connection lost', function(t) {
    t.plan(assertExecutorLost(t, 'executor-reconnect-timeout'));
    // Shorten error stack with setImmediate
    setImmediate(function() {
      router.client.channel.onError(new Error('reconnect-timeout'));
    });
  });

  function assertExecutorLost(t, why) {
    // track plan manually, the end event is broken, see
    //   https://github.com/isaacs/node-tap/issues/153
    // t.on('end', end);
    var plan = 0;

    container.disconnect = function(reason) {
      if (++plan === 2)
        end();
      t.equal(reason, why, 'container disconnect');
    };
    var _close = router.client.channel.close;
    router.client.channel.close = function(reason) {
      if (++plan === 2)
        end();
      t.equal(reason, why, 'channel close');
    };

    function end() {
      container.disconnect = null;
      router.client.channel.close = _close;
    }

    return 2;
  }


  // Mandatory because of the use of timeout:, :-(
  return t.end();
});
