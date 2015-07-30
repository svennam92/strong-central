#!/usr/bin/env node

var Parser = require('posix-getopt').BasicParser;
var fs = require('fs');
var path = require('path');
var slServiceInstall = require('strong-service-install');

module.exports = install;
install.log = console.log;
install.error = console.error;
install.platform = process.platform;
install.$0 = process.env.CMD || path.basename(process.argv[1]);
install.execPath = process.execPath;
install.slSvcInstall = slServiceInstall;

if (require.main === module) {
  install(process.argv, function(err) {
    process.exit(err ? 1 : 0);
  });
}

function printHelp($0, prn) {
  var usageFile = require.resolve('../bin/sl-central-install.txt');
  var USAGE = fs.readFileSync(usageFile, 'utf-8')
                .replace(/%MAIN%/g, $0)
                .trim();
  prn(USAGE);
}

function install(argv, callback) {
  var $0 = install.$0;
  var parser = new Parser([
      ':v(version)',
      'h(help)',
      'b:(base)',
      'u:(user)',
      'g:(group)',
      'p:(port)',
      'j:(job-file)',
      'n(dry-run)',
      'f(force)',
      'U:(upstart)',
      's(systemd)',
      'a:(http-auth)',
      'L:(license)',
    ].join(''),
    argv);

  var jobConfig = {
    user: 'strong-central',
    centralBaseDir: null, // defaults to options.cwd in fillInHome
    centralPort: 8701,
    dryRun: false,
    jobFile: null, // strong-service-install provides an init-specific default
    force: false,
    upstart: false,
    systemd: false,
    env: {},
    centralEnv: '',
    centralSeedEnv: {},
  };

  var license;
  var option;
  while ((option = parser.getopt()) !== undefined) {
    switch (option.option) {
      case 'v':
        install.log(require('../package.json').version);
        return callback();
      case 'h':
        printHelp($0, install.log);
        return callback();
      case 'b':
        jobConfig.centralBaseDir = option.optarg;
        break;
      case 'p':
        jobConfig.centralPort = option.optarg | 0; // cast to an integer
        break;
      case 'u':
        jobConfig.user = option.optarg;
        break;
      case 'g':
        jobConfig.group = option.optarg;
        break;
      case 'j':
        jobConfig.jobFile = option.optarg;
        break;
      case 'n':
        jobConfig.dryRun = true;
        break;
      case 'f':
        jobConfig.force = true;
        break;
      case 'U':
        jobConfig.upstart = option.optarg;
        break;
      case 's':
        jobConfig.systemd = true;
        break;
      case 'a':
        jobConfig.env.STRONGLOOP_PM_HTTP_AUTH = option.optarg;
        break;
      case 'L':
        license = option.optarg;
        break;
      default:
        install.error('Invalid usage (near option \'%s\'), try `%s --help`.',
          option.optopt, $0);
        return callback(Error('usage'));
    }
  }

  if (parser.optind() !== argv.length) {
    install.error('Invalid usage (extra arguments), try `%s --help`.', $0);
    return callback(Error('usage'));
  }

  if (!license) {
    license = require('strongloop-license')('mesh:central', 'EXIT');
    if (!license) return;
    license = license.key;
  }

  jobConfig.env.STRONGLOOP_LICENSE = license;

  if (jobConfig.centralPort < 1) {
    install.error('Invalid port specified, try `%s --help`.', $0);
    return callback(Error('usage'));
  }

  jobConfig.name = 'strong-central';
  jobConfig.description = 'StrongLoop Mesh Central';

  slServiceInstall.log = install.log;
  slServiceInstall.error = install.error;
  slServiceInstall.$0 = install.$0;
  slServiceInstall.platform = install.platform;
  slServiceInstall.ignorePlatform = install.ignorePlatform;

  if (jobConfig.centralBaseDir) {
    jobConfig.centralBaseDir = path.resolve(jobConfig.centralBaseDir);
    jobConfig.dirs = [jobConfig.centralBaseDir];
  }

  jobConfig.command = [
    install.execPath,
    require.resolve('./sl-central'),
    '--listen', jobConfig.centralPort,
    // relative to CWD, which defaults to $HOME of user that central runs as
    '--base', jobConfig.centralBaseDir || '.',
  ];

  return install.slSvcInstall(jobConfig, report);

  function report(err) {
    if (err) {
      install.error('Error installing service \'%s\':',
                    jobConfig.name, err.message);
    }
    return callback(err);
  }
}
