var Server = require('../server/server');
var mktmpdir = require('mktmpdir');
var test = require('tap').test;
var url = require('url');

function createCentralAndTest(title, testFn) {
  test(title, function(t) {
    mktmpdir(function(err, dir, cleanup) {
      t.ok(!err, 'Temp working directory should be created');
      t.on('end', cleanup);

      var centralApp = new Server({
        baseDir: dir,
      });
      centralApp.on('listening', function() {
        var centralUri = new url.parse('http://127.0.0.1');
        centralUri.port = centralApp.port();

        testFn(t, centralApp, centralUri);
      });
      centralApp.start();
    });
  });
}
exports.createCentralAndTest = createCentralAndTest;
