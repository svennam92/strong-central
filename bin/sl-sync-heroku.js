#!/usr/bin/env node

'use strict';

var Parser = require('posix-getopt').BasicParser;
var fs = require('fs');
var license = require('strongloop-license');
var mkdirp = require('mkdirp').sync;
var nconf = require('nconf');
var path = require('path');
var versionApi = require('strong-mesh-models/package.json').version;
var versionCentral = require('../package.json').version;

function printHelp($0, prn) {
  var USAGE = fs.readFileSync(require.resolve('./sl-sync-heroku.txt'), 'utf-8')
    .replace(/%MAIN%/g, $0)
    .trim();

  prn(USAGE);
}

function main(argv, callback) {
  if (!callback) {
    callback = function() {};
  }

  var $0 = process.env.CMD ? process.env.CMD : path.basename(argv[1]);
  var parser = new Parser([
    ':v(version)',
    'h(help)',
    'b:(base)',
    'c(check)',
    'd(dry-run)',
    'u(update)',
  ].join(''), argv);

  var base = '.strong-central';
  var cmd = null;
  var driver = 'executor';
  var configFile = null;

  var option;
  while ((option = parser.getopt()) !== undefined) {
    switch (option.option) {
      case 'v':
        console.log(require('../package.json').version);
        return callback();
      case 'h':
        printHelp($0, console.log);
        return callback();
      case 'b':
        base = option.optarg;
        cmd = option.option;
        break;
      case 'c':
        cmd = option.option;
        break;
      case 'd':
        cmd = option.option;
        break;
      case 'u':
        cmd = option.option;
        break;
      default:
        console.error('Invalid usage (near option \'%s\'), try `%s --help`.',
          option.optopt,
          $0);
        return callback(Error('Invalid usage'));
    }
  }

  if (!license('mesh:central', licenseCheck))
    return;

  // We only want the default message when unlicensed, be silent on success.
  function licenseCheck(err, req, res) {
    if (err || !res)
      require('strongloop-license').EXIT(err, req, res);
  }


  base = path.resolve(base);

  nconf.env();
  if (configFile) nconf.file('driver', configFile);

  // Run from base directory, so files and paths are created in it.
  mkdirp(base);
  process.chdir(base);

  if (parser.optind() !== argv.length) {
    console.error('Invalid usage (extra arguments), try `%s --help`.', $0);
    return callback(Error('Invalid usage'));
  }

  if (cmd == null) {
    console.error('Cmd was not specified, try `%s --help`.', $0);
    return callback(Error('Missing cmd'));
  }

  console.log('sl-sync-heroku: %s %s %s %s', cmd, base, versionApi, versionCentral);

}

main(process.argv, function(er) {
  if (!er) {
    process.exit(0);
  }
  process.exit(1);
});
