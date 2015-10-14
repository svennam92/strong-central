var async = require('async');
var crypto = require('crypto');
var debug = require('debug')('strong-central:driver:bluemix:bm-instance');

module.exports = function(BMServiceInstance) {
  // Only methods PUT, PATCH and DELETE are required by the
  // Bluemix Service Broker API.
  // https://docs.cloudfoundry.org/services/api.html#provisioning

  // XXX(KR): PATCH op for plan change not currently implemented

  BMServiceInstance.disableRemoteMethod('create', true);
  BMServiceInstance.disableRemoteMethod('find', true);
  BMServiceInstance.disableRemoteMethod('upsert', true);
  BMServiceInstance.disableRemoteMethod('createChangeStream', true);
  BMServiceInstance.disableRemoteMethod('count', true);
  BMServiceInstance.disableRemoteMethod('findOne', true);
  BMServiceInstance.disableRemoteMethod('updateAll', true);
  BMServiceInstance.disableRemoteMethod('exists', true);
  BMServiceInstance.disableRemoteMethod('updateAttributes', false);
  BMServiceInstance.disableRemoteMethod('__get__sLUser', false);

  BMServiceInstance.remoteMethod(
    'createInstance',
    {
      http: {path: '/:id', verb: 'put'},
      isStatic: true,
      accepts: [{
        arg: 'id',
        required: true,
        type: 'string',
        http: {source: 'path'}
      }, {
        arg: 'bmInstance',
        required: true,
        type: 'BMServiceInstance',
        http: {source: 'body'}
      }],
      returns: {arg: 'response', type: 'BMServiceInstance', root: true}
    }
  );

  BMServiceInstance.remoteMethod(
    'bindApplication',
    {
      http: {path: '/service_bindings/:bid', verb: 'put'},
      isStatic: false,
      accepts: [{
        arg: 'bid',
        required: true,
        type: 'string',
        http: {source: 'path'}
      }, {
        arg: 'bmBinding',
        required: true,
        type: 'BMServiceBinding',
        http: {source: 'body'}
      }],
      returns: {arg: 'response', type: 'object', root: true}
    }
  );

  BMServiceInstance.remoteMethod(
    'unbindApplication',
    {
      http: {path: '/service_bindings/:bid', verb: 'delete'},
      isStatic: false,
      accepts: [{
        arg: 'bid',
        required: true,
        type: 'string',
        http: {source: 'path'}
      }, {
        arg: 'service_id',
        type: 'string',
        http: {source: 'query'}
      }, {
        arg: 'plan_id',
        type: 'string',
        http: {source: 'query'}
      }],
      returns: {arg: 'response', type: 'object', root: true}
    }
  );

  // Event constants for audit logs
  BMServiceInstance.PROVISION = 'provision';
  BMServiceInstance.LINK_SL_USER = 'link-sl-user';
  BMServiceInstance.ISSUE_LICENSE = 'issue-license';
  BMServiceInstance.DEPROVISION = 'deprovision';

  BMServiceInstance.BIND_APP = 'bind-app';
  BMServiceInstance.LINK_MESH_MODELS = 'link-mesh-models';

  BMServiceInstance.CONTAINER_STARTED = 'container-started';
  BMServiceInstance.CONTAINER_STOPPED = 'container-stopped';

  BMServiceInstance.UNBIND_APP = 'unbind-app';
  BMServiceInstance.DESTROY_MESH_MODELS = 'destroy-mesh-models';

  function log(eventType, data, err, callback) {
    var BMAuditLog = BMServiceInstance.app.models.BMAuditLog;

    BMAuditLog.create({
      eventType: eventType,
      metadata: data,
      bmServiceInstanceId: this.id,
      error: err ? err.message : null,
    }, function(err) {
      if (err) console.error('Unable to save audit log: ', err.message);
    });
    if (callback) callback(err);
  }
  BMServiceInstance.prototype.log = log;

  function createInstance(id, bmInstance, callback) {
    bmInstance.id = id;
    BMServiceInstance.beginTransaction(
      {isolationLevel: BMServiceInstance.Transaction.READ_COMMITTED},
      function(err, tx) {
        if (err) return callback(err);
        var options = {transaction: tx};
        async.series([
          bmInstance.findOrCreateSLUser.bind(bmInstance, options),
          bmInstance.getLicense.bind(bmInstance),
          bmInstance.save.bind(bmInstance, options),
          tx.commit.bind(tx)
        ], function(err) {
          bmInstance.log(
            BMServiceInstance.PROVISION, {BMServiceInstanceId: id}, err
          );
          if (err) return tx.rollback(function(rbErr) {
            if (rbErr) debug(err);
            callback(err);
          });
          callback();
        });
      }
    );
  }
  BMServiceInstance.createInstance = createInstance;

  function bindApplication(bid, bmBinding, callback) {
    bmBinding.id = bid;
    bmBinding.bmServiceInstanceId = this.id;
    bmBinding.sLUserId = this.sLUserId;

    var models = BMServiceInstance.app.models;
    var Service = models.ServerService;
    var Executor = models.Executor;
    var self = this;

    BMServiceInstance.beginTransaction(
      {isolationLevel: BMServiceInstance.Transaction.READ_UNCOMMITTED},
      function(err, tx) {
        if (err) return callback(err);
        var options = {transaction: tx};

        async.series([
          createService,
          createExecutor,
          bmBinding.save.bind(bmBinding, options),
          tx.commit.bind(tx)
        ], function(err) {
          self.log(
            BMServiceInstance.BIND_APP, {BMServiceInstanceId: bid}, err
          );
          if (err) return tx.rollback(function(rbErr) {
            if (rbErr) debug(err);
            callback(err);
          });
          callback();
        });

        function createService(callback) {
          Service.findOrCreate(
            {where: {bm_service_binding_id: bmBinding.id}},
            {
              name: bmBinding.app_guid,
              groups: [{id: 1, name: 'default', scale: 1}],
              sLUserId: self.sLUserId,
              bm_service_binding_id: bmBinding.id,
            },
            options,
            function(err, s) {
              self.log(
                BMServiceInstance.LINK_MESH_MODELS,
                {model: 'ServerService', id: s.id},
                err, callback
              );
            }
          );
        }

        function createExecutor(callback) {
          Executor.findOrCreate(
            {where: {bm_service_binding_id: bmBinding.id}},
            {
              hostname: 'bluemix-' + bmBinding.app_guid,
              driver: 'bluemix',
              sLUserId: self.sLUserId,
              bm_service_binding_id: bmBinding.id,
            },
            options,
            function(err, s) {
              self.log(
                BMServiceInstance.LINK_MESH_MODELS,
                {model: 'Executor', id: s.id},
                err, callback
              );
            }
          );
        }
      }
    );
  }
  BMServiceInstance.prototype.bindApplication = bindApplication;

  /**
   * Work with the StrongLoop User Auth subsystem to find or create a new
   * user account for the Bluemix Organization.
   */
  function findOrCreateSLUser(options, callback) {
    var SLUser = BMServiceInstance.app.models.SLUser;
    var self = this;

    crypto.randomBytes(64, function(err, buf) {
      if (err) return callback(err);
      var email = self.organization_guid + '@bluemix.local';
      var password = buf.toString('base64');

      SLUser.findOrCreate(
        {
          where: {username: self.organization_guid}
        }, {
          username: self.organization_guid,
          email: email,
          password: password,
        },
        options,
        function(err, user) {
          if (err) return callback(err);
          self.sLUserId = user.id;
          self.log(
            BMServiceInstance.LINK_SL_USER,
            {user: user.id}, err, callback
          );
        }
      );
    });
  }
  BMServiceInstance.prototype.findOrCreateSLUser = findOrCreateSLUser;

  /**
   * Get a product license from the SL Auth subsystem based on the addon plan.
   */
  function getLicense(callback) {
    var self = this;

    // TODO: Contact auth2.strongloop.com and get license
    setImmediate(function(err) {
      if (err) return callback(err);

      var lic = 'xyz';
      self.license = lic;
      self.log(BMServiceInstance.ISSUE_LICENSE, null, err, callback);
    });
  }
  BMServiceInstance.prototype.getLicense = getLicense;

  /**
   * Deprovision the service.
   */
  function unbindApplication(bid, service_id, plan_id, callback) {
    var BMServiceBinding = BMServiceInstance.app.models.BMServiceBinding;
    var self = this;

    BMServiceInstance.beginTransaction(
      {isolationLevel: BMServiceInstance.Transaction.READ_UNCOMMITTED},
      function(err, tx) {
        if (err) return callback(err);
        var options = {transaction: tx};

        BMServiceBinding.findById(bid, options, function(err, binding) {
          if (err) return callback(err);
          async.series([
            destroyService.bind(null, binding),
            destroyExecutor.bind(null, binding),
            binding.delete.bind(binding, options),
            tx.commit.bind(tx),
          ], function(err) {
            self.log(
              BMServiceInstance.UNBIND_APP,
              {BMBindingId: bid},
              err);
            if (err) {
              return tx.rollback(function(rberr) {
                self.log(
                  BMServiceInstance.UNBIND_APP,
                  {BMBindingId: bid, rollback: true},
                  rberr, callback
                );
              });
            }
            callback();
          });
        });

        function destroyService(binding, callback) {
          binding.serverService(options, function(err, s) {
            if (err || !s) {
              return self.log(
                BMServiceInstance.DESTROY_MESH_MODELS,
                {model: 'ServerService'},
                err || Error('Unable to find service'), callback
              );
            }

            s.instances.destroyAll({}, options, function(err) {
              self.log(
                BMServiceInstance.DESTROY_MESH_MODELS,
                {model: 'ServiceInstance', bmServiceBindingId: binding.id},
                err);
              if (err) return callback(err);

              s.delete(options, function(err) {
                self.log(
                  BMServiceInstance.DESTROY_MESH_MODELS,
                  {model: 'ServerService', id: s.id},
                  err, callback
                );
              });
            });
          });
        }

        function destroyExecutor(binding, callback) {
          binding.executor(options, function(err, exec) {
            if (err || !exec) {
              return self.log(
                BMServiceInstance.DESTROY_MESH_MODELS,
                {model: 'Executor'},
                err || Error('Unable to find executor'), callback
              );
            }
            exec.delete(options, function(err) {
              return self.log(
                BMServiceInstance.DESTROY_MESH_MODELS,
                {model: 'Executor', id: exec.id},
                err, callback
              );
            });
          });
        }
      }
    );
  }
  BMServiceInstance.prototype.unbindApplication = unbindApplication;

  BMServiceInstance.observe('before delete', function(ctx, next) {
    BMServiceInstance.find(
      {where: ctx.where},
      function(err, insts) {
        async.each(insts, function(inst, callback) {
          inst.log(
            BMServiceInstance.DEPROVISION,
            {BMServiceInstanceId: inst.id},
            err, callback
          );
        }, next);
      }
    );
  });
};
