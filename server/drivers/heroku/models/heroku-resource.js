var auth = require('basic-auth');
var async = require('async');
var request = require('request');
var debug = require('debug')('strong-central:driver:heroku:resource');
var url = require('url');

function herokuResource(HerokuResource) {
  HerokuResource.disableRemoteMethod('find', true);
  HerokuResource.disableRemoteMethod('upsert', true);
  HerokuResource.disableRemoteMethod('createChangeStream', true);
  HerokuResource.disableRemoteMethod('count', true);
  HerokuResource.disableRemoteMethod('findOne', true);
  HerokuResource.disableRemoteMethod('updateAll', true);
  HerokuResource.disableRemoteMethod('exists', true);
  HerokuResource.disableRemoteMethod('__get__executor', false);
  HerokuResource.disableRemoteMethod('__destroy__executor', false);
  HerokuResource.disableRemoteMethod('__create__executor', false);
  HerokuResource.disableRemoteMethod('__update__executor', false);
  HerokuResource.disableRemoteMethod('__get__serverService', false);
  HerokuResource.disableRemoteMethod('__destroy__serverService', false);
  HerokuResource.disableRemoteMethod('__create__serverService', false);
  HerokuResource.disableRemoteMethod('__update__serverService', false);
  HerokuResource.disableRemoteMethod('__get__SLUser', false);

  HerokuResource.PROVISION = 'provision';
  HerokuResource.UPDATE_APP_INFO = 'update-app-info';
  HerokuResource.LINK_SL_USER = 'link-sl-user';
  HerokuResource.LINK_MESH_MODELS = 'link-mesh-models';
  HerokuResource.ISSUE_LICENSE = 'issue-license';
  HerokuResource.UPDATE_ADDON_ENV = 'update-addon-env';
  HerokuResource.PLAN_CHANGE = 'plan-change';
  HerokuResource.DYNO_STARTED = 'dyno-started';
  HerokuResource.DYNO_STOPPED = 'dyno-stopped';
  HerokuResource.DEPROVISION = 'deprovision';
  HerokuResource.DESTROY_MESH_MODELS = 'destroy-mesh-models';

  /**
   * Check credentials for incoming requests from Heroku. The `username` is the
   * `id` and the `password` is the `password` field of the add-on manifest.
   * @method checkAccess
   * @param  {[string]}  token        Loopback auth token
   * @param  {[string]}  modelId      ID if the model being accessed
   * @param  {[string]}  sharedMethod Method being invoked
   * @param  {[object]}  ctx          Loopback context object
   *                                  (Contains request and response).
   * @param  {Function}  callback     Callback.
   */
  function checkAccess(token, modelId, sharedMethod, ctx, callback) {
    var credentials = auth(ctx.req);
    callback(null,
      credentials &&
      credentials.name === HerokuResource.apiUser &&
      credentials.pass === HerokuResource.apiPassword
    );
  }
  HerokuResource.checkAccess = checkAccess;

  /**
   * After remote hook. Allows customization of response from API.
   */
  HerokuResource.afterRemote('create', function(ctx, instance, callback) {
    ctx.res.statusCode = 202;

    ctx.result = {
      id: instance.id,
      message: 'Your Strongloop account is being provisioned',
    };

    ctx.res.on('finish', function() {
      // Heroku app info API for this resource is only available after the
      // resource has been provisioned and response has been sent.
      setImmediate(completeProvisioning.bind(instance));
    });

    instance.log(HerokuResource.PROVISION, {plan: this.plan});

    setImmediate(callback);
  });

  function completeProvisioning(callback) {
    async.series([
      this.updateAppOwnerInfo.bind(this),
      this.findOrCreateSLUser.bind(this),
      this.createMeshModels.bind(this),
      this.getLicense.bind(this),
      this.updateHerokuConfig.bind(this),
    ], function(err) {
      // TODO: Ask heroku how we can cleanup if an error occures during the
      // provisioning process
      if (err) debug('Error while provisioning', err);
      if (callback) callback(err);
    });
  }
  HerokuResource.prototype.completeProvisioning = completeProvisioning;

  function updateAppOwnerInfo(callback) {
    var self = this;
    this.makeApiRequest(
      'https://api.heroku.com/vendor/apps/' + this.id, 'get', null,
      function(err, res, body) {
        if (err) {
          return self.log(
            HerokuResource.UPDATE_APP_INFO,
            null, err, callback
          );
        }

        if (res.statusCode === 404) {
          // Based on Heroku docs:
          // The requested app doesn’t exist (e.g., it has been deleted) or
          // the add-on has been deprovisioned for this app.

          self.log(
            HerokuResource.UPDATE_APP_INFO,
            {statusCode: res.statusCode},
            Error('Unable to lookup application')
          );

          return self.destroy(function(err) {
            if (err) return callback(err);
            callback(Error('App/addon has been deprovisioned'));
          });
        }

        self.log(
          HerokuResource.UPDATE_APP_INFO,
          {
            owner_email: body.owner_email,
            app_name: body.name,
          }
        );

        self.updateAttributes({
          domains: body.domains,
          owner_email: body.owner_email,
          region: body.region,
          app_name: body.name,
        }, callback);
      }
    );
  }
  HerokuResource.prototype.updateAppOwnerInfo = updateAppOwnerInfo;

  function findOrCreateSLUser(callback) {
    var SLUser = HerokuResource.app.models.SLUser;
    var self = this;

    SLUser.findOrCreate(
      {username: this.owner_email},
      {
        username: this.owner_email,
        email: this.owner_email,
        password: 'abc',
      },
      function(err, user) {
        if (err) {
          return self.log(
            HerokuResource.LINK_SL_USER,
            null, err, callback
          );
        }

        self.log(HerokuResource.LINK_SL_USER, {SLUserId: user.id});
        self.updateAttributes({
          SLUserId: user.id,
        }, callback);
      }
    );
  }
  HerokuResource.prototype.findOrCreateSLUser = findOrCreateSLUser;

  function createMeshModels(callback) {
    var models = HerokuResource.app.models;
    var Service = models.ServerService;
    var Executor = models.Executor;
    var self = this;

    async.series([
      function createService(callback) {
        Service.findOrCreate({herokuResourceId: self.id}, {
          name: self.app_name,
          groups: [{id: 1, name: 'default', scale: 1}],
          SLUserId: self.SLUserId,
          herokuResourceId: self.id,
        }, function(err, service) {
          self.log(
            HerokuResource.LINK_MESH_MODELS,
            {model: 'ServerService', id: service ? service.id : null},
            err, callback
          );
        });
      },
      function createExecutor(callback) {
        Executor.findOrCreate({herokuResourceId: self.id}, {
          hostname: 'heroku' + self.uuid,
          driver: 'heroku',
          SLUserId: self.SLUserId,
          herokuResourceId: self.id,
        }, function(err, exec) {
          self.log(
            HerokuResource.LINK_MESH_MODELS,
            {model: 'Executor', id: exec ? exec.id : null},
            err, callback
          );
        });
      }
    ], callback);
  }
  HerokuResource.prototype.createMeshModels = createMeshModels;

  function getLicense(callback) {
    var self = this;

    // TODO: Create or update account in auth2.strongloop.com and get license
    setImmediate(function(err) {
      var lic = 'xyz';
      if (err) {
        return self.log(HerokuResource.ISSUE_LICENSE, null, err, callback);
      }

      self.updateAttributes({
        license: lic,
      }, function(err) {
        self.log(HerokuResource.ISSUE_LICENSE, {license: lic}, err, callback);
      });
    });
  }
  HerokuResource.prototype.getLicense = getLicense;

  function updateHerokuConfig(callback) {
    var self = this;
    var registrationUrl = url.parse(HerokuResource.registrationUrl);

    self.executor(function(err, exec) {
      if (err) {
        return self.log(HerokuResource.UPDATE_ADDON_ENV, null, err, callback);
      }

      registrationUrl.auth = exec.token;
      var addonInfo = {
        registrationUrl: url.format(registrationUrl),
        herokuResourceId: self.id,
      };
      addonInfo = new Buffer(JSON.stringify(addonInfo)).toString('base64');

      var updateValue = {
        config: {
          'STRONGLOOP_LICENSE': self.license,
          'STRONGLOOP_ADDON_INFO': addonInfo,
        }
      };

      self.makeApiRequest(
        'https://api.heroku.com/vendor/apps/' + self.id,
        'put', updateValue, function(err) {
          self.log(
            HerokuResource.UPDATE_ADDON_ENV, updateValue, err, callback
          );
        }
      );
    });
  }
  HerokuResource.prototype.updateHerokuConfig = updateHerokuConfig;

  function makeApiRequest(uri, method, body, callback) {
    var options = {
      method: method,
      uri: uri,
      json: true,
      auth: {
        user: HerokuResource.apiUser,
        pass: HerokuResource.apiPassword,
        sendImmediately: true,
      }
    };
    if (body) options.body = body;

    return request(options, function(err, res, body) {
      if (err) return callback(err);
      if (res.statusCode === 401)
        return callback(Error(body.message || 'Access denied'));
      return callback(err, res, body);
    });
  }
  HerokuResource.prototype.makeApiRequest = makeApiRequest;

  function log(eventType, data, err, callback) {
    var HerokuAuditLog = HerokuResource.app.models.HerokuAuditLog;
    HerokuAuditLog.create({
      eventType: eventType,
      herokuResourceModelId: this.id,
      herokuUuid: this.uuid,
      herokuAppId: this.heroku_id,
      metadata: data,
      error: err ? err.message : null,
    }, function(err) {
      if (err) console.error('Unable to save audit log: ', err.message);
    });
    if (callback) callback(err);
  }
  HerokuResource.prototype.log = log;

  HerokuResource.observe('before delete', function(ctx, next) {
    var Instance = HerokuResource.app.models.ServiceInstance;

    HerokuResource.find({where: ctx.where}, function(err, resources) {
      if (err) next(err);
      return async.each(
        resources,
        function(resource, callback) {
          resource.log(HerokuResource.DEPROVISION, {id: resource.id});

          async.series([
            destroyExecutor.bind(null, resource),
            destroyService.bind(null, resource),
          ], callback);
        },
        next
      );
    });

    function destroyService(resource, callback) {
      resource.serverService(function(err, s) {
        if (err || !s) {
          return resource.log(
            HerokuResource.DESTROY_MESH_MODELS,
            {model: 'ServerService'},
            err || Error('Unable to find service'), callback
          );
        }

        Instance.destroyAll(
          {herokuResourceId: resource.id},
          function(err) {
            return resource.log(
              HerokuResource.DESTROY_MESH_MODELS,
              {model: 'ServiceInstance', herokuResourceId: resource.id},
              err);
          }
        );

        s.delete(function(err) {
          return resource.log(
            HerokuResource.DESTROY_MESH_MODELS,
            {model: 'ServerService', id: s.id},
            err, callback
          );
        });
      });
    }

    function destroyExecutor(resource, callback) {
      resource.executor(function(err, exec) {
        if (err || !exec) {
          return resource.log(
            HerokuResource.DESTROY_MESH_MODELS,
            {model: 'Executor'},
            err || Error('Unable to find executor'), callback
          );
        }
        exec.delete(function(err) {
          return resource.log(
            HerokuResource.DESTROY_MESH_MODELS,
            {model: 'Executor', id: exec.id},
            err, callback
          );
        });
      });
    }
  });
}
module.exports = herokuResource;
