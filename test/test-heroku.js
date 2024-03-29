var _ = require('lodash');
var debug = require('debug')('strong-central:test:heroku');
var fmt = require('util').format;
var nock = require('nock');
var os = require('os');
var request = require('supertest');
var testHelper = require('./heroku-driver-helper').testHelper;

testHelper(function(t, baseDir, conf, meshApp, driver) {
  var authHeader = 'Basic ' + new Buffer(fmt(
    '%s:%s', conf.get('heroku:apiUser'), conf.get('heroku:apiPassword')
  )).toString('base64');

  var herokuApi = nock('https://api.heroku.com', {
      reqheaders: {
        'authorization': authHeader
      }
    }).log(debug);

  var HerokuResource = meshApp.models.HerokuResource;
  var HerokuAuditLog = meshApp.models.HerokuAuditLog;

  t.test('Invalid Auth', function(tt) {
    var authHeader = 'Basic invalidauth';

    request(meshApp)
      .post('/api/heroku/resources')
      .set('Authorization', authHeader)
      .send({
        heroku_id: 'app1234@heroku.com',
        plan: 'basic',
        region: 'amazon-web-services::us-east-1',
        callback_url: 'https://api.heroku.com/vendor/apps/app1234@heroku.com',
        options: {},
        uuid: '01234567-89ab-cdef-0123-456789abcdef'
      })
      .expect(401, tt.end.bind(tt));
  });

  var herokuResource = null;
  var executorModel = null;
  t.test('Provision service', function(tt) {
    tt.plan(10);

    request(meshApp)
      .post('/api/heroku/resources')
      .set('Authorization', authHeader)
      .send({
        heroku_id: 'app1234@heroku.com',
        plan: 'basic',
        region: 'amazon-web-services::us-east-1',
        callback_url: 'https://api.heroku.com/vendor/apps/app1234@heroku.com',
        options: {},
        uuid: '01234567-89ab-cdef-0123-456789abcdef'
      })
      .expect(202, createHerokuInfoApiMock);

    function createHerokuInfoApiMock(err, res) {
      tt.ifError(err);
      herokuResource = res.body;

      herokuApi
        .get('/vendor/apps/' + herokuResource.id)
        .reply(200, {
          id: 'app123@heroku.com',
          callback_url:
            'https://api.heroku.com/vendor/apps/app123%40heroku.com',
          config: {},
          domains: [],
          name: 'myapp',
          owner_email: 'kraman@somewhere.com',
          region: 'amazon-web-services::us-east-1',
          resource: {uuid: '01234567-89ab-cdef-0123-456789abcdef'}
        });

      herokuApi
        .put('/vendor/apps/' + herokuResource.id, function(body) {
          setImmediate(verifyModels);
          if (!body.config || !body.config.STRONGLOOP_LICENSE ||
            !body.config.STRONGLOOP_ADDON_INFO) return false;

          var addonInfo = JSON.parse(new Buffer(
            body.config.STRONGLOOP_ADDON_INFO, 'base64').toString('ascii'));
          return addonInfo.registrationUrl &&
            addonInfo.herokuResourceId === herokuResource.id;
        })
        .reply(200);
    }

    function verifyModels() {
      tt.ok(herokuApi.isDone(), 'Expected HTTP calls should be completed');
      nock.cleanAll();

      HerokuResource.findById(herokuResource.id, function(err, r) {
        tt.ifError(err);
        tt.ok(r, 'Resource model should exist');

        r.serverService(function(err, s) {
          tt.ifError(err);
          tt.ok(s, 'Service model should exist');
        });
        r.executor(function(err, e) {
          tt.ifError(err);
          executorModel = e;
          tt.ok(e, 'Executor model should exist');
        });
        r.sLUser(function(err, u) {
          tt.ifError(err);
          tt.ok(u, 'User model should exist');
        });
      });

    }
  });

  var herokuExecutor = null;
  var instanceModelId = null;
  t.test('register heroku dyno', function(tt) {
    driver.createExecutor(executorModel.id, function(err, exec, data) {
      herokuExecutor = exec;
      tt.ifError(err);
      executorModel.updateAttributes({
        metadata: data.metadata,
        token: data.token,
      }, function(err) {
        tt.ifError(err);

        herokuExecutor._onRequest({
          cmd: 'register-dyno',
          herokuResourceId: herokuResource.id,
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

  var herokuContainer = null;
  t.test('test heroku driver: create instance', function(tt) {
    herokuContainer = driver.createInstance({
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
      herokuExecutor.instanceRequest(
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

    herokuContainer.request = function(req, callback) {
      tt.deepEqual(req, cmd);
      callback({ok: 1});
    };

    herokuExecutor.instanceRequest(
      instanceModelId, cmd, function(err, res) {
        tt.ifError(err);
        tt.deepEqual(res, {ok: 1});
      }
    );
  });

  t.test('Heroku dyno exit', function(tt) {
    herokuContainer.emit('disconnect-exit', instanceModelId);
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

  t.test('Deprovision service', function(tt) {
    tt.plan(7);
    HerokuResource.findById(herokuResource.id, function(err, r) {
      tt.ifError(err);

      request(meshApp)
        .delete('/api/heroku/resources/' + r.id)
        .set('Authorization', authHeader)
        .expect(201, verifyModels);

      function verifyModels() {
        HerokuResource.findById(herokuResource.id, function(err, r) {
          tt.ifError(err);
          tt.equal(r, null, 'Resource model should not exist');
        });

        r.serverService(function(err, s) {
          tt.ifError(err);
          tt.equal(s, null, 'Service model should not exist');
        });

        r.executor(function(err, e) {
          tt.ifError(err);
          tt.equal(e, null, 'Executor model should not exist');
        });
      }
    });
  });

  t.test('Audit logs', function(tt) {
    HerokuAuditLog.find(function(err, logs) {
      tt.ifError(err);
      var expected = {
        'provision': 1,
        'update-app-info': 1,
        'link-sl-user': 1,
        'link-mesh-models': 2,
        'issue-license': 1,
        'update-addon-env': 1,
        'dyno-started': 1,
        'dyno-stopped': 1,
        'deprovision': 1,
        'destroy-mesh-models': 3
      };
      tt.deepEqual(_(logs).countBy('eventType').value(), expected);
      tt.end();
    });
  });
});
