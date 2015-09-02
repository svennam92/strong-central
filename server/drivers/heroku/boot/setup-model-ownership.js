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

  Instance.nestRemoting('processes');
};
