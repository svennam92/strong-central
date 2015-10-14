module.exports = function(BMCatalog) {
  BMCatalog.remoteMethod(
    'getCatalog',
    {
      http: {path: '/', verb: 'get'},
      isStatic: true,
      returns: {arg: 'response', type: 'object', root: true}
    }
  );

  BMCatalog.getCatalog = function(callback) {
    var catalog = BMCatalog.app.get('BM:apiCatalog');
    callback(null, catalog);
  };
};
