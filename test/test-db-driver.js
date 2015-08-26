var Server = require('../server/server');
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

      var dbFile = path.join(dir, 'bar.db');
      var centralApp = new Server({
        baseDir: dir,
        'mesh.db.driver': 'postgresql',
        'mesh.db.filePath': dbFile,
      });
      var ds = centralApp._meshApp.dataSources.db;
      tt.equal(ds.connector.name, 'postgresql');
      tt.equal(ds.connector.settings.file, dbFile);
      centralApp.stop(tt.end.bind(tt));
    });
  });

  t.end();

});
