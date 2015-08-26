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
  var HerokuResource = server.models.HerokuResource;

  ServerService.belongsTo(SLUser);
  Executor.belongsTo(SLUser);
  SLUser.hasMany(ServerService);
  SLUser.hasMany(Executor);
  HerokuResource.hasMany(Instance);
  Instance.belongsTo(HerokuResource);
};
