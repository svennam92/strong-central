/**
 * All ServerService, Executor and Instance models are there to track Heroku
 * applications and dynos. Each application is owned by a user that is used in
 * the SL Auth backend to assign License keys. This function sets up relations
 * between the SLUser and models. It also associates the HerokuResource with the
 * Instance models that are tracking dyno usage.
 */
module.exports = function setupModelOwnership(server) {
  var SLUser = server.models.SLUser;
  var ServerService = server.models.ServerService;
  var Executor = server.models.ServerService;
  var Instance = server.models.ServiceInstance;
  var BMServiceBinding = server.models.BMServiceBinding;

  ServerService.definition.properties.sLUserId.postgresql =
    {column: 'sLUserId'};
  ServerService.belongsTo(SLUser, {
    foreignKey: 'sLUserId'
  });
  SLUser.hasMany(ServerService, {
    foreignKey: 'sLUserId'
  });

  Executor.definition.properties.sLUserId.postgresql = {column: 'sLUserId'};
  Executor.belongsTo(SLUser, {
    foreignKey: 'sLUserId'
  });
  SLUser.hasMany(Executor, {
    foreignKey: 'sLUserId'
  });

  BMServiceBinding.hasMany(Instance, {
    foreignKey: 'bmServiceBindingId',
  });
  Instance.belongsTo(BMServiceBinding, {
    foreignKey: 'bmServiceBindingId',
  });
  Instance.definition.properties.bmServiceBindingId.postgresql =
    {column: 'bmServiceBindingId'};
};
