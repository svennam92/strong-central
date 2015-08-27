module.exports = function setupModelOwnership(server) {
  var SLUser = server.models.SLUser;
  var ServerService = server.models.ServerService;
  var Executor = server.models.ServerService;
  var Instance = server.models.ServiceInstance;

  ServerService.belongsTo(SLUser);
  Executor.belongsTo(SLUser);
  SLUser.hasMany(ServerService);
  SLUser.hasMany(Executor);

  Instance.nestRemoting('processes');
};
