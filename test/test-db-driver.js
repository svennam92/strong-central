var Server = require('../server/server');
var fmt = require('util').format;
var mktmpdir = require('mktmpdir');
var path = require('path');
var test = require('tap').test;

test('Test DB Drivers', function(t) {
  t.test('memory db', function(tt) {
    mktmpdir(function(err, dir, cleanup) {
      tt.ok(!err, 'Temp working directory should be created');
      tt.on('end', cleanup);

      var dbFile = path.join(dir, 'foo.json');
      var centralApp = new Server({
        baseDir: dir,
        'mesh.db.driver': 'memory',
        'mesh.db.filePath': dbFile,
      });
      var ds = centralApp._meshApp.dataSources.db;
      tt.equal(ds.connector.name, 'memory');
      tt.equal(ds.connector.settings.file, dbFile);
      centralApp.stop(tt.end.bind(tt));
    });
  });

  t.test('sqlite3 db', function(tt) {
    mktmpdir(function(err, dir, cleanup) {
      tt.ok(!err, 'Temp working directory should be created');
      tt.on('end', cleanup);

      var dbFile = path.join(dir, 'foo.db');
      var centralApp = new Server({
        baseDir: dir,
        'mesh.db.driver': 'sqlite3',
        'mesh.db.filePath': dbFile,
      });
      var ds = centralApp._meshApp.dataSources.db;
      tt.equal(ds.connector.name, 'sqlite3');
      tt.equal(ds.connector.settings.file, dbFile);
      centralApp.stop(tt.end.bind(tt));
    });
  });

  t.test('postgresql db', function(tt) {
    mktmpdir(function(err, dir, cleanup) {
      tt.ok(!err, 'Temp working directory should be created');
      tt.on('end', cleanup);

      var POSTGRESQL_PARAM = fmt('postgres://%s:%s@%s:%d/%s',
          process.env.POSTGRESQL_USER || 'postgres',
          process.env.POSTGRESQL_PASSWORD || 'postgres',
          process.env.POSTGRESQL_HOST || 'localhost',
          process.env.POSTGRESQL_PORT || 5432,
          process.env.POSTGRESQL_DATABASE || 'postgres');

      var dbFile = path.join(dir, 'foo.db');
      var centralApp = new Server({
        baseDir: dir,
        'mesh.db.driver': 'postgresql',
        'mesh.db.filePath': dbFile,
        user: process.env.POSTGRESQL_USER || 'postgres',
        password: process.env.POSTGRESQL_PASSWORD || 'postgres',
        host: process.env.POSTGRESQL_HOST || 'localhost',
        port: process.env.POSTGRESQL_PORT || 5432,
        database: process.env.POSTGRESQL_DATABASE || 'postgres',
        url: POSTGRESQL_PARAM,
      });
      var ds = centralApp._meshApp.dataSources.db;
      tt.equal(ds.connector.name, 'postgresql');
      centralApp.stop(tt.end.bind(tt));
    });
  });

  t.end();
});
