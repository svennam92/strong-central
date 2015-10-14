var auth = require('basic-auth');

module.exports = function(server) {
  server.models.BMCatalog.checkAccess = checkAccess;
  server.models.BMServiceBinding.checkAccess = checkAccess;
  server.models.BMServiceInstance.checkAccess = checkAccess;

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
    var apiUser = server.get('BM:apiUser');
    var apiPassword = server.get('BM:apiPassword');
    var credentials = auth(ctx.req);

    callback(null,
      credentials &&
      credentials.name === apiUser &&
      credentials.pass === apiPassword);
  }
};
