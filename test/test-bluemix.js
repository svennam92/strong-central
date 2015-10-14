var fmt = require('util').format;
var os = require('os');
var request = require('supertest');
var testHelper = require('./bluemix-driver-helper').testHelper;

testHelper(function(t, baseDir, conf, meshApp, driver) {
  var authHeader = 'Basic ' + new Buffer(fmt(
    '%s:%s', conf.get('bluemix:apiUser'), conf.get('bluemix:apiPassword')
  )).toString('base64');

  var BMServiceBinding = meshApp.models.BMServiceBinding;
  var BMServiceInstance = meshApp.models.BMServiceInstance;

  t.test('Invalid Auth', function(tt) {
    var authHeader = 'Basic invalidauth';

    request(meshApp)
      .get('/api/bluemix/v2/catalog')
      .set('Authorization', authHeader)
      .send({})
      .expect(401, tt.end.bind(tt));
  });

  t.test('Catalog', function(tt) {
    request(meshApp)
      .get('/api/bluemix/v2/catalog')
      .set('Authorization', authHeader)
      .send({})
      .expect(200, checkCatalog);

    function checkCatalog(err, res) {
      tt.ifError(err);

      tt.deepEqual(res.body, {
        'services': [{
          'id': '7852b91a-93c9-4151-90c0-18328c578c85',
          'name': 'StrongLoop',
          'description': 'StrongLoop node.js monitoring add-on',
          'bindable': true,
          'plans': [{
            'id': '238ea7ff-ff0e-4b31-a904-a815f152b85d',
            'name': 'free',
            'description': 'Metrics, profile and staging for 1 small container'
          }],
          'dashboard_client': {
            'id': 'mJhZ9G7ppoj8d0cW7bCvF5E/u2DDuFziq+d5hGG4/fw=',
            'secret': 'YGuPSfGOS3bPSf6PxfMrUntXofgGdLAOgnHkbXWqtFg=',
            'redirect_uri': 'https://bluemix.do.strongloop.com:8701/dashboard'
          }
        }]
      });
      tt.end(tt);
    }
  });

  t.test('Provision service', function(tt) {
    request(meshApp)
      .put(
        '/api/bluemix/v2/service_instances/1d1563e7-e445-43bb-b38e-14b0ffefc8c9'
      ).set('Authorization', authHeader)
      .send({
        'organization_guid': '17d4e88c-d02a-4f56-b97b-62f1f7ad3042',
        'plan_id': '238ea7ff-ff0e-4b31-a904-a815f152b85d',
        'service_id': 'f95d6a16-0f1e-4ef5-8ece-3251d5d3ea59',
        'space_guid': '2626f189-088b-4348-b1ef-ad3ea9348fe1'
      })
      .expect(200, verifyModels);

    function verifyModels(err) {
      tt.ifError(err);
      BMServiceInstance.findById(
        '1d1563e7-e445-43bb-b38e-14b0ffefc8c9',
        function(err, i) {
          tt.ifError(err);
          tt.equal(i.organization_guid, '17d4e88c-d02a-4f56-b97b-62f1f7ad3042');
          tt.equal(i.plan_id, '238ea7ff-ff0e-4b31-a904-a815f152b85d');
          tt.equal(i.service_id, 'f95d6a16-0f1e-4ef5-8ece-3251d5d3ea59');
          tt.equal(i.space_guid, '2626f189-088b-4348-b1ef-ad3ea9348fe1');
          i.sLUser(function(err, u) {
            tt.ifError(err);
            tt.equal(u.username, '17d4e88c-d02a-4f56-b97b-62f1f7ad3042');
            tt.ok(u.password, 'Password should be set');
            tt.equal(
              u.email, '17d4e88c-d02a-4f56-b97b-62f1f7ad3042@bluemix.local'
            );
            tt.end();
          });
        }
      );
    }
  });

  var executorModel = null;
  t.test('Bind service', function(tt) {
    tt.plan(13);

    request(meshApp)
      .put(
        '/api/bluemix/v2/service_instances/' +
        '1d1563e7-e445-43bb-b38e-14b0ffefc8c9/service_bindings/' +
        '904079b9-7c89-4004-b5a8-41d65e25a34b'
      ).set('Authorization', authHeader)
      .send({
        'plan_id': '238ea7ff-ff0e-4b31-a904-a815f152b85d',
        'service_id': 'f95d6a16-0f1e-4ef5-8ece-3251d5d3ea59',
        'app_guid': 'c6193803-50fb-48de-b6ae-5df8b2125c7b'
      })
      .expect(200, verifyModels);

    function verifyModels(err) {
      tt.ifError(err);
      BMServiceBinding.findById(
        '904079b9-7c89-4004-b5a8-41d65e25a34b',
        function(err, binding) {
          tt.ifError(err);
          tt.equal(binding.app_guid, 'c6193803-50fb-48de-b6ae-5df8b2125c7b');
          tt.equal(binding.plan_id, '238ea7ff-ff0e-4b31-a904-a815f152b85d');
          tt.equal(binding.service_id, 'f95d6a16-0f1e-4ef5-8ece-3251d5d3ea59');
          tt.equal(binding.bmServiceInstanceId,
            '1d1563e7-e445-43bb-b38e-14b0ffefc8c9');
          tt.equal(binding.sLUserId, 1);

          binding.serverService(function(err, s) {
            tt.ifError(err);
            tt.ok(s, 'Service model should exist');
          });
          binding.executor(function(err, e) {
            tt.ifError(err);
            executorModel = e;
            tt.ok(e, 'Executor model should exist');
          });
          binding.sLUser(function(err, u) {
            tt.ifError(err);
            tt.ok(u, 'User model should exist');
          });
        }
      );
    }
  });

  var bmExecutor = null;
  var instanceModelId = null;
  t.test('register bluemix container', function(tt) {
    driver.createExecutor(executorModel.id, function(err, exec, data) {
      bmExecutor = exec;
      tt.ifError(err);
      executorModel.updateAttributes({
        metadata: data.metadata,
        token: data.token,
      }, function(err) {
        tt.ifError(err);

        bmExecutor._onRequest({
          cmd: 'register-container',
          bmServiceBindingId: '904079b9-7c89-4004-b5a8-41d65e25a34b',
          os: {
            platform: os.platform(),
            arch: os.arch(),
            release: os.release()
          },
          node: process.version,
          container: {
            name: 'web1',
            size: '512m',
            supervisorVersion: '1.2.3',
            version: '1.0.0',
          },
          cpus: os.cpus().length,
          agentVersion: '1.3.4',
        }, function(res) {
          tt.ok(res.controlUri, 'Control URI should exist');
          instanceModelId = res.instanceId;
          tt.end();
        });
      });
    });
  });

  t.test('Ensure instance exists', function(tt) {
    var Instance = meshApp.models.ServiceInstance;
    Instance.findById(instanceModelId, function(err, inst) {
      tt.ifError(err);
      tt.ok(inst, 'Instance should be created');
      tt.equal(+inst.stopTime, 0, 'Stop time should not be set');
      tt.end();
    });
  });

  var bmContainer = null;
  t.test('test bluemix driver: create instance', function(tt) {
    bmContainer = driver.createInstance({
      executorId: executorModel.id,
      instanceId: instanceModelId,
      env: {},
      deploymentId: '',
      token: 'foo-token',
      startOptions: {},
    }, function(err) {
      tt.ifError(err);
      tt.end();
    });
  });

  t.test('test unsuppoted commands', function(tt) {
    var cmds = ['start', 'stop', 'restart', 'soft-stop', 'soft-restart'];
    tt.plan(cmds.length * 2);
    for (var i in cmds) {
      bmExecutor.instanceRequest(
        instanceModelId, {cmd: cmds[i]}, checkError
      );
    }

    function checkError(err) {
      tt.ok(err, 'Command should error');
      tt.equal(err.message, 'not supported');
    }
  });

  t.test('test supervisor commands', function(tt) {
    tt.plan(3);
    var cmd = {cmd: 'set-size', size: 1};

    bmContainer.request = function(req, callback) {
      tt.deepEqual(req, cmd);
      callback({ok: 1});
    };

    bmExecutor.instanceRequest(
      instanceModelId, cmd, function(err, res) {
        tt.ifError(err);
        tt.deepEqual(res, {ok: 1});
      }
    );
  });

  t.test('Bluemix container exit', function(tt) {
    bmContainer.emit('disconnect-exit', instanceModelId);
    setImmediate(function() {
      var Instance = meshApp.models.ServiceInstance;
      Instance.findById(instanceModelId, function(err, inst) {
        tt.ifError(err);
        tt.ok(inst, 'Instance should exist');
        tt.ok(inst.stopTime, 'Stop time should be set');
        tt.end();
      });
    });
  });

  t.test('Unbind application', function(tt) {
    tt.plan(7);
    BMServiceBinding.findById('904079b9-7c89-4004-b5a8-41d65e25a34b',
      function(err, r) {
        tt.ifError(err);

        request(meshApp)
          .delete(
            '/api/bluemix/v2/service_instances/' +
            '1d1563e7-e445-43bb-b38e-14b0ffefc8c9/service_bindings/' +
            '904079b9-7c89-4004-b5a8-41d65e25a34b'
          ).set('Authorization', authHeader)
          .expect(200, verifyModels);

        function verifyModels() {
          BMServiceBinding.findById('904079b9-7c89-4004-b5a8-41d65e25a34b',
            function(err, r) {
              tt.ifError(err);
              tt.equal(r, null, 'Service binding model should not exist');
            }
          );

          r.serverService(function(err, s) {
            tt.ifError(err);
            tt.equal(s, null, 'Service model should not exist');
          });

          r.executor(function(err, e) {
            tt.ifError(err);
            tt.equal(e, null, 'Executor model should not exist');
          });
        }
      }
    );
  });

  t.test('Deprovision service', function(tt) {
    tt.plan(4);
    BMServiceInstance.findById('1d1563e7-e445-43bb-b38e-14b0ffefc8c9',
      function(err, r) {
        tt.ifError(err);
        tt.ok(r, 'Service instance model should exist');

        request(meshApp)
          .delete(
            '/api/bluemix/v2/service_instances/' +
            '1d1563e7-e445-43bb-b38e-14b0ffefc8c9'
          ).set('Authorization', authHeader)
          .expect(200, verifyModels);

        function verifyModels() {
          BMServiceInstance.findById('1d1563e7-e445-43bb-b38e-14b0ffefc8c9',
            function(err, r) {
              tt.ifError(err);
              tt.equal(r, null, 'Service instance model should not exist');
            }
          );
        }
      }
    );
  });
});
