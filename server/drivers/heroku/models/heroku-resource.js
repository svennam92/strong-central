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
    process.nextTick(callback);
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
        if (err) return callback(err);
        if (res.statusCode === 404) {
          // Based on Heroku docs:
          // The requested app doesn’t exist (e.g., it has been deleted) or
          // the add-on has been deprovisioned for this app.
          return self.destroy(function(err) {
            if (err) return callback(err);
            callback(Error('App/addon has been deprovisioned'));
          });
        }

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
        if (err) return callback(err);
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
      Service.create.bind(Service, {
        name: this.app_name,
        groups: [{id: 1, name: 'default', scale: 1}],
        SLUserId: this.SLUserId,
        herokuResourceId: self.id,
      }),
      Executor.create.bind(Executor, {
        hostname: 'heroku' + this.uuid,
        driver: 'heroku',
        SLUserId: this.SLUserId,
        herokuResourceId: self.id,
      }),
    ], callback);
  }
  HerokuResource.prototype.createMeshModels = createMeshModels;

  function getLicense(callback) {
    // TODO: Create or update account in auth2.strongloop.com and get license
    this.updateAttributes({
      license: 'xyz',
    }, callback);
  }
  HerokuResource.prototype.getLicense = getLicense;

  function updateHerokuConfig(callback) {
    var self = this;
    var registrationUrl = url.parse(HerokuResource.registrationUrl);

    self.executor(function(err, exec) {
      if (err) return callback(err);
      registrationUrl.auth = exec.token;
      var addonInfo = {
        registrationUrl: url.format(registrationUrl),
        herokuResourceId: self.id,
      };
      addonInfo = new Buffer(JSON.stringify(addonInfo)).toString('base64');

      self.makeApiRequest(
        'https://api.heroku.com/vendor/apps/' + self.id, 'put', {
          config: {
            'STRONGLOOP_LICENSE': self.license,
            'STRONGLOOP_ADDON_INFO': addonInfo,
          }
        }, callback
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

  HerokuResource.observe('before delete', function(ctx, next) {
    ctx.Model.find({where: ctx.where}, function(err, instances) {
      if (err) next(err);
      return async.each(
        instances,
        function(instance, callback) {
          async.series([
            function(callback) {
              instance.executor(function(err, exec) {
                if (err) return callback(err);
                exec.delete(callback);
              });
            },
            function(callback) {
              instance.serverService(function(err, svc) {
                if (err) return callback(err);
                svc.delete(callback);
              });
            },
          ], callback);
        },
        next
      );
    });
  });
}
module.exports = herokuResource;
