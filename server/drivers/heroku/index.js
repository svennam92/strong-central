'use strict';

var BaseDriver = require('../common/driver');
var Executor = require('./executor');
var boot = require('loopback-boot');
var fs = require('fs');
var herokuConf = JSON.parse(
  fs.readFileSync(__dirname + '/addon-manifest.json', 'utf-8')
);
var util = require('util');

function HerokuDriver(options) {
  BaseDriver.call(this, options);
  this._Executor = options.Executor || Executor;

  var meshApp = this._server.getMeshApp();
  boot(meshApp, __dirname);
  var HerokuResource = meshApp.models.HerokuResource;
  HerokuResource.apiUser = herokuConf.id;
  HerokuResource.apiPassword = herokuConf.api.password;
  HerokuResource.registrationUrl = herokuConf.api.production.registration_url;
  HerokuResource.supervisorUrl = herokuConf.api.production.supervisor_url;

  this._executors = {};
}
util.inherits(HerokuDriver, BaseDriver);

module.exports = HerokuDriver;
