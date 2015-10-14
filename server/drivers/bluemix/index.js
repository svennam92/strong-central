'use strict';

var BaseDriver = require('../common/driver');
var Executor = require('./executor');
var boot = require('loopback-boot');
var util = require('util');
var mandatory = require('../../util').mandatory;

function BluemixDriver(options) {
  BaseDriver.call(this, options);
  this._Executor = options.Executor || Executor;

  var meshApp = this._server.getMeshApp();
  boot(meshApp, __dirname);

  var bmUser = this._config.get('bluemix:apiUser');
  var bmPassword = this._config.get('bluemix:apiPassword');
  var bmCatalog = this._config.get('bluemix:catalog');
  var bmRegistrationUri = this._config.get('bluemix:registrationUri');
  var bmSupervisorUrl = this._config.get('bluemix:supervisorUrl');

  mandatory(bmUser);
  mandatory(bmPassword);
  mandatory(bmCatalog);
  meshApp.set('BM:apiUser', bmUser);
  meshApp.set('BM:apiPassword', bmPassword);
  meshApp.set('BM:apiCatalog', bmCatalog);
  meshApp.set('BM:registrationUri', bmRegistrationUri);
  meshApp.set('BM:supervisorUrl', bmSupervisorUrl);

  this._executors = {};
}
util.inherits(BluemixDriver, BaseDriver);
BluemixDriver.NAME = 'Bluemix';
BluemixDriver.SUPPORTS_BASIC_AUTH = false;
BluemixDriver.REQUIRES_SCHEDULER = false;

module.exports = BluemixDriver;
