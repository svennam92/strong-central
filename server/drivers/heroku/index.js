'use strict';

var BaseDriver = require('../common/driver');
var Executor = require('./executor');
var boot = require('loopback-boot');
var util = require('util');

function HerokuDriver(options) {
  BaseDriver.call(this, options);
  this._Executor = options.Executor || Executor;

  var meshApp = this._server.getMeshApp();
  boot(meshApp, __dirname);
  var HerokuResource = meshApp.models.HerokuResource;
  HerokuResource.apiUser = this._config.apiUser;
  HerokuResource.apiPassword = this._config.apiPassword;
  HerokuResource.registrationUrl = this._config.registrationUri;
  HerokuResource.supervisorUrl = this._config.supervisorUrl;

  this._executors = {};
}
util.inherits(HerokuDriver, BaseDriver);

module.exports = HerokuDriver;
