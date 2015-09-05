var Server = require('../server/server');
var fmt = require('util').format;
var mktmpdir = require('mktmpdir');
var test = require('tap').test;
var url = require('url');

var defaultTestDbDriver = 'memory';
// Driver choice: memory sqlite3 postgresql

function createCentralAndTest(title, testFn) {
  test(title, function(t) {
    mktmpdir(function(err, dir, cleanup) {
      t.ok(!err, 'Temp working directory should be created');
      t.on('end', cleanup);
      var POSTGRESQL_PARAM = fmt('postgres://%s:%s@%s:%d/%s',
          process.env.POSTGRESQL_USER || 'postgres',
          process.env.POSTGRESQL_PASSWORD || 'postgres',
          process.env.POSTGRESQL_HOST || 'localhost',
          process.env.POSTGRESQL_PORT || 5432,
          process.env.POSTGRESQL_DATABASE || 'postgres');
      var dbDriver = process.env.TEST_DB_DRIVER || defaultTestDbDriver;
      var centralApp = new Server({
        'mesh.db.driver': dbDriver,
        baseDir: dir,
        listenPort: 0,
        url: (dbDriver === 'postgresql') ? POSTGRESQL_PARAM : null,
      });

      // Cleanup database
      centralApp._meshApp.dataSources.db.automigrate(function() {
        centralApp.start();
      });

      centralApp.on('listening', function() {
        var centralUri = new url.parse('http://127.0.0.1');
        centralUri.port = centralApp.port();
        testFn(t, centralApp, centralUri, function() {
          t.end();
        });
      });

    });
  });
}
exports.createCentralAndTest = createCentralAndTest;
