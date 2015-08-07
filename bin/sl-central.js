#!/usr/bin/env node

'use strict';

var Parser = require('posix-getopt').BasicParser;
var Server = require('../server/server');
var license = require('strongloop-license');
var mkdirp = require('mkdirp').sync;
var path = require('path');
var fs = require('fs');
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
  ].join(''), argv);

  var base = '.strong-central';
  var listen = 8701;

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

  // Run from base directory, so files and paths are created in it.
  mkdirp(base);
  process.chdir(base);

  var app = new Server({
    cmdName: $0, baseDir: base, listenPort: listen,
  });

  app.on('listening', function(listenAddr) {
    console.log('%s: StrongLoop Central v%s (API v%s) ' +
                'listening on port `%s`, work base is `%s`',
                $0, versionCentral, versionApi,
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
