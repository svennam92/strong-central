module.exports = function(ArcApp) {
  function list(callback) {
    return callback(null, ArcApps);
  }
  ArcApp.list = list;

  ArcApp.remoteMethod('list', {
    http: {verb: 'get', path: '/'},
    returns: {arg: 'results', type: ['ArcApp']}
  });

  var ArcApps = [
    {
      'id': 'metrics',
      'name': 'Metrics',
      'description': 'Gather and view application performance metrics.',
      'disabled': false,
      'beta': false,
      'supports': '*'
    },
    {
      'id': 'profiler',
      'name': 'Profiler',
      'description': 'Profile applications’ CPU and memory consumption.',
      'supports': '*'
    },
  ].map(function(app) {
    var arcApp = new ArcApp(app);
    arcApp.supportsCurrentProject = true;
    return arcApp;
  });
};
