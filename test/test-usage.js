var path = require('path');
var tap = require('tap');
var shelljs = require('shelljs');

tap.comment('working dir for %s is %s', process.argv[1], process.cwd());

// Prevent usage text from confusing the TAP parser
console.log = console.error;

tap.test('Test CLI usage', function(t) {
  var cmd = path.join(__dirname, '../bin/sl-central.js');

  t.test('-h/--help/-hv', function(tt) {
    var res1 = shelljs.exec(cmd + ' -h', {silent: true});
    tt.equal(res1.code, 0, 'command should have 0 exit-code');

    var res2 = shelljs.exec(cmd + ' --help', {silent: true});
    tt.equal(res2.code, 0, 'command should have 0 exit-code');

    var res3 = shelljs.exec(cmd + ' -hv', {silent: true});
    tt.equal(res3.code, 0, 'command should have 0 exit-code');

    tt.equal(res1.output, res2.output, 'Help output should match');
    tt.equal(res1.output, res3.output, 'Help output should match');

    tt.end();
  });

  t.test('-v/--version/-vh', function(tt) {
    var res1 = shelljs.exec(cmd + ' -v', {silent: true});
    tt.equal(res1.code, 0, 'command should have 0 exit-code');

    var res2 = shelljs.exec(cmd + ' --version', {silent: true});
    tt.equal(res2.code, 0, 'command should have 0 exit-code');

    var res3 = shelljs.exec(cmd + ' -vh', {silent: true});
    tt.equal(res3.code, 0, 'command should have 0 exit-code');

    tt.equal(res1.output, res2.output, 'Version output should match');
    tt.equal(res1.output, res3.output, 'Version output should match');

    tt.end();
  });

  t.test('fail on invalid arg', function(tt) {
    var res = shelljs.exec(cmd + ' no-such-arc', {silent: true});
    tt.equal(res.code, 1, 'command should have 1 exit-code');
    tt.end();
  });

  t.test('fail on invalid option', function(tt) {
    var res1 = shelljs.exec(cmd + ' --no-such-option', {silent: true});
    tt.equal(res1.code, 1, 'command should have 1 exit-code');

    var res2 = shelljs.exec(cmd + ' -Z', {silent: true});
    tt.equal(res2.code, 1, 'command should have 1 exit-code');
    tt.end();
  });

  t.end();
});
