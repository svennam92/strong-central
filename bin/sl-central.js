#!/usr/bin/env node

'use strict';

var Parser = require('posix-getopt').BasicParser;
var Server = require('../server/server');
var fmt = require('util').format;
var fs = require('fs');
var license = require('strongloop-license');
var mkdirp = require('mkdirp').sync;
var path = require('path');
var versionApi = require('strong-mesh-models/package.json').version;
var versionCentral = require('../package.json').version;

function printHelp($0, prn) {
  var USAGE = fs.readFileSync(require.resolve('./sl-central.txt'), 'utf-8')
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
    'l:(listen)',
    'N(no-control)',
    'd:(driver)',
    'o:(options)',
  ].join(''), argv);

  var base = '.strong-central';
  var listen = 8701;
  var driver = 'executor';
  var driverConfigFile = null;

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
        break;
      case 'l':
        listen = option.optarg;
        break;
      case 'd':
        driver = option.optarg.toLowerCase();
        break;
      case 'o':
        driverConfigFile = option.optarg;
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

  if (parser.optind() !== argv.length) {
    console.error('Invalid usage (extra arguments), try `%s --help`.', $0);
    return callback(Error('Invalid usage'));
  }

  if (listen == null) {
    console.error('Listen port was not specified, try `%s --help`.', $0);
    return callback(Error('Missing listen port'));
  }

  var driverConfig = {};
  if (driverConfigFile) {
    try {
      driverConfig = JSON.parse(fs.readFileSync(driverConfigFile, 'utf8'));
    } catch (_) {
      console.error(
        'Unable to read the driver options: %s, try `%s --help`.',
        driverConfigFile, $0
      );
      return callback(Error('Invalid driver options'));
    }
  }

  // Run from base directory, so files and paths are created in it.
  mkdirp(base);
  process.chdir(base);

  var app = new Server({
    cmdName: $0,
    baseDir: base,
    listenPort: listen,
    ExecutorDriver: require(fmt('../server/drivers/%s', driver)),
    driverConfig: driverConfig,
  });

  app.on('listening', function(listenAddr) {
    console.log('%s: StrongLoop Central v%s (API v%s)\n' +
                'Running with %s driver\n' +
                'Listening on port `%s`, work base is `%s`',
                $0, versionCentral, versionApi, app.driverName(),
                listenAddr.port, base);
  });

  app.start(callback);

  return app;
}

main(process.argv, function(er) {
  if (!er) {
    process.exit(0);
  }
  process.exit(1);
});
