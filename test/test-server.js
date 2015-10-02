var Server = require('../server/server');
var mktmpdir = require('mktmpdir');
var request = require('supertest');
var test = require('tap').test;

test('Test Server', function(t) {
  var server = null;
  var cleanup = null;
  t.test('creation', function(t) {
    mktmpdir(function(err, dir, tempCleanup) {
      t.ifError(err, 'Temp working directory should be created');
      cleanup = tempCleanup;
      server = new Server({
        baseDir: dir,
      });
      t.assert(server, 'server should be created');
      server.on('listening', function(addr) {
        t.ok(addr, 'listening on an address');
        t.ok(addr.port, 'listening on a port');
        t.end();
      });
      t.end();
    });
  });

  t.test('startup', {skip: 'no tests require this yet'}, function(t) {
    t.end();
  });

  t.test('/status', function(t) {
    request(server._baseApp)
      .get('/status')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        t.ifError(err, 'should match content-type and status code');
        var st = res.body;
        t.ok(st.freemem, 'should report free memory');
        t.ok(st.totalmem, 'should report total memroy');
        t.ok(st.loadavg, 'should report load average');
        t.ok(st.driver, 'should report driver name');
        // XXX: this is because the server hasn't actually been started
        t.notOk(st.accepting, 'should not claim to be accepting requests');
        t.end();
      });
  });

  t.test('shutdown', function(t) {
    t.pass('shutting down server');
    server.stop(t.end);
  });

  t.test('cleanup', function(t) {
    t.pass('cleaning up tempdir');
    cleanup();
    t.end();
  });
  t.end();
});
