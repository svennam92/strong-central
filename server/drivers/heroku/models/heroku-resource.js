var auth = require('basic-auth');
var async = require('async');
var request = require('request');
var debug = require('debug')('strong-central:driver:heroku:resource');
var url = require('url');

function herokuResource(HerokuResource) {
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
    ctx.res.responseCode = 202;

    ctx.result = {
      id: instance.id,
      message: 'Your Strongloop account is being provisioned',
    };

    ctx.res.on('finish', function() {
      // Heroku app info API for this resource is only available after the
      // resource has been provisioned and response has been sent.
      setImmediate(function() {
        async.series([
          instance.updateAppOwnerInfo.bind(instance),
          instance.createMeshModels.bind(instance),
          instance.getLicense.bind(instance),
          instance.updateHerokuConfig.bind(instance),
        ], function(err) {
          // TODO: Ask heroku how we can cleanup if an error occures during the
          // provisioning process
          debug(err);
        });
      });
    });
    process.nextTick(callback);
  });

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

  function createMeshModels(callback) {
    var models = HerokuResource.app.models;
    var Service = models.ServerService;
    var Executor = models.Executor;
    var self = this;

    async.series([
      Service.create.bind(Service, {
        name: this.app_name,
        groups: [{id: 1, name: 'default', scale: 1}],
      }),
      Executor.create.bind(Executor, {
        hostname: 'heroku' + this.uuid,
        driver: 'heroku'
      }),
    ], function(err, results) {
      if (err) return callback(err);
      self.updateAttributes({
        executorId: results[1].id,
        serverServiceId: results[0].id,
      }, callback);
    });
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
    var Executor = HerokuResource.app.models.Executor;
    var registrationUrl = url.parse(HerokuResource.registrationUrl);

    Executor.findById(this.executorId, function(err, exec) {
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
    request.debug = true;

    return request(options, function(err, res, body) {
      if (err) return callback(err);
      if (res.statusCode === 401)
        return callback(Error(body.message || 'Access denied'));
      return callback(err, res, body);
    });
  }
  HerokuResource.prototype.makeApiRequest = makeApiRequest;

  HerokuResource.observe('before delete', function(ctx, next) {
    var models = HerokuResource.app.models;
    var Service = models.ServerService;
    var Executor = models.Executor;

    ctx.Model.find({where: ctx.where}, function(err, instances) {
      if (err) next(err);
      return async.each(
        instances,
        function(instance, callback) {
          async.series([
            Executor.deleteById.bind(Executor, instance.executorId),
            Service.deleteById.bind(Service, instance.serverServiceId),
          ], callback);
        },
        next
      );
    });
  });
}
module.exports = herokuResource;
