/**
 * The heroku driver exposes the central API to the open internet. All the API
 * functionality (except for actions) should be read-only. This function
 * locks down all models.
 *
 * start/stop/restart instance methods are also removed since we cannot control
 * the Heroku Dyno via the Central API.
 */
module.exports = function(server) {
  makeReadOnly(server.models.AgentTrace);
  makeReadOnly(server.models.ServerService);
  makeReadOnly(server.models.Executor);
  makeReadOnly(server.models.ExpressUsageRecord);
  makeReadOnly(server.models.ProfileData);
  makeReadOnly(server.models.ServiceInstance);
  makeReadOnly(server.models.ServiceMetric);
  makeReadOnly(server.models.ServiceProcess);
  makeReadOnly(server.models.Gateway);
  makeReadOnly(server.models.SLUser);

  var Executor = server.models.Executor;
  Executor.disableRemoteMethod('shutdown', false);

  var Instance = server.models.ServiceInstance;
  Instance.disableRemoteMethod('restart', false);
  Instance.disableRemoteMethod('start', false);
  Instance.disableRemoteMethod('stop', false);

  var Service = server.models.ServerService;
  Service.disableRemoteMethod('deploy', false);
  Service.disableRemoteMethod('setEnvs', false);
  Service.disableRemoteMethod('setEnv', false);
  Service.disableRemoteMethod('unsetEnv', false);

  function makeReadOnly(model) {
    model.disableRemoteMethod('create', true);
    model.disableRemoteMethod('upsert', true);
    model.disableRemoteMethod('updateAttributes', false);
    model.disableRemoteMethod('deleteById', true);
    model.disableRemoteMethod('createChangeStream', true);
    model.disableRemoteMethod('updateAll', true);
    for (var i in model.relations) {
      model.disableRemoteMethod('__delete__' + i, false);
      model.disableRemoteMethod('__destroy__' + i, false);
      model.disableRemoteMethod('__destroyById__' + i, false);
      model.disableRemoteMethod('__updateById__' + i, false);
      model.disableRemoteMethod('__unlink__' + i, false);
      model.disableRemoteMethod('__link__' + i, false);
      model.disableRemoteMethod('__create__' + i, false);
      model.disableRemoteMethod('__update__' + i, false);
    }
  }
};
