var tap = require('tap');
var cp = require('child_process');

tap.comment('working dir for %s is %s', process.argv[1], process.cwd());

var cmd = require.resolve('../bin/sl-central');

tap.test('-h/--help/-hv', function(t) {
  var res1;
  var res2;
  var res3;

  t.test('-h', function(t) {
    cp.exec(cmd + ' -h', function(err, stdout) {
      res1 = stdout;
      t.ifError(err, 'should exit cleanly');
      t.end();
    });
  });
  t.test('--help', function(t) {
    cp.exec(cmd + ' --help', function(err, stdout) {
      res2 = stdout;
      t.ifError(err, 'should exit cleanly');
      t.end();
    });
  });
  t.test('-hv', function(t) {
    cp.exec(cmd + ' -hv', function(err, stdout) {
      res3 = stdout;
      t.ifError(err, 'should exit cleanly');
      t.end();
    });
  });
  t.test('equivalence', function(t) {
    t.equal(res1, res2, 'Help output should match');
    t.equal(res1, res3, 'Help output should match');
    t.end();
  });
  t.end();
});

tap.test('-v/--version/-vh', function(t) {
  var res1;
  var res2;
  var res3;

  t.test('-v', function(t) {
    cp.exec(cmd + ' -v', function(err, stdout) {
      res1 = stdout;
      t.ifError(err, 'should exit cleanly');
      t.end();
    });
  });
  t.test('--version', function(t) {
    cp.exec(cmd + ' --version', function(err, stdout) {
      res2 = stdout;
      t.ifError(err, 'should exit cleanly');
      t.end();
    });
  });
  t.test('-vh', function(t) {
    cp.exec(cmd + ' -vh', function(err, stdout) {
      res3 = stdout;
      t.ifError(err, 'should exit cleanly');
      t.end();
    });
  });
  t.test('equivalence', function(t) {
    t.equal(res1, res2, 'Help output should match');
    t.equal(res1, res3, 'Help output should match');
    t.end();
  });
  t.end();
});

tap.test('fail on invalid arg', function(t) {
  cp.exec(cmd + ' no-such-arc', function(err, stdout, stderr) {
    t.equal(err && err.code, 1, 'should have exit code 1');
    t.match(stderr, /extra arguments/, 'should have an error message');
    t.end();
  });
});

tap.test('fail on invalid option', function(t) {
  t.test('long opt', function(t) {
    cp.exec(cmd + ' --no-such-option', function(err, stdout, stderr) {
      t.equal(err && err.code, 1, 'should have exit code 1');
      t.match(stderr, /near option 'no-such-option'/);
      t.end();
    });
  });
  t.test('long opt', function(t) {
    cp.exec(cmd + ' -Z', function(err, stdout, stderr) {
      t.equal(err && err.code, 1, 'should have exit code 1');
      t.match(stderr, /near option 'Z'/);
      t.end();
    });
  });
  t.end();
});
