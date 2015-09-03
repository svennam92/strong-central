'use strict';

var Gateway = require('./gateway');
var WebsocketRouter = require('strong-control-channel/ws-router');
var async = require('async');
var mandatory = require('../util').mandatory;

/**
 ../util D.mandatoryriver for gateway management.
 *
 * @constructor
 * @param {object} options Options object
 * @param {Server} options.server Central server
 * @param {WebsocketRouter} options.WebsocketRouter Injectable WebsocketRouter
 * class for testing.
 * @param {Gateway} options.Gateway Injectable Gateway class for testing.
 */
function GatewayDriver(options) {
  mandatory(options);
  mandatory(options.server);

  this._server = options.server;
  this._WebsocketRouter = options.WebsocketRouter || WebsocketRouter;
  this._Gateway = options.Gateway || Gateway;

  this._gwRouter = new this._WebsocketRouter(
    this._server.getHttpServer(),
    this._server.getBaseApp(),
    'gateway-control'
  );

  this._gateways = {};
}

function init(callback) {
  setImmediate(callback);
}
GatewayDriver.prototype.init = init;

/**
 * Create a new gateway connection
 *
 * @param {string} gatewayId ID of the new gateway
 * @param {string} [token] Authentication token. If null, a new token will be
 * generated.
 * @param {function} callback fn(err, gatewayData)
 */
function createGateway(gatewayId, token, callback) {
  if (typeof token === 'function') {
    callback = token;
    token = null;
  }

  var gateway = this._gateways[gatewayId] = new this._Gateway({
    server: this._server,
    router: this._gwRouter,
    id: gatewayId,
    token: token,
  });
  gateway.listen(callback);
  gateway.on('resync', this._server.onGatewayConnect.bind(this._server));
  return gateway;
}
GatewayDriver.prototype.createGateway = createGateway;

/**
 * Perform a full sync with a gateway. This will erase all endpoints on the
 * gateway and create new ones.
 * @param  {String}      gatewayId        ID of gateway to update
 * @param  {object}      serviceEndpoints Array of services and endpoints
 * @param  {Function}    callback         Callback function
 */
function updateGateway(gatewayId, serviceEndpoints, callback) {
  this._gateways[gatewayId].sync(serviceEndpoints, callback);
}
GatewayDriver.prototype.updateGateway = updateGateway;

/**
 * Update all gateways with endpoint information about one service.
 * @param  {object}      serviceEndpoints Service endpoints
 * @param  {Function}    callback         Callback function
 */
function updateGateways(serviceEndpoints, callback) {
  var self = this;

  async.each(Object.keys(self._gateways), function(gatewayId, callback) {
    self._gateways[gatewayId].update(serviceEndpoints, callback);
  }, callback);
}
GatewayDriver.prototype.updateGateways = updateGateways;
/**
 * Shutdown the driver and all its connections. Does not shutdown the gateways.
 * @param {function} callback fn(err)
 */
function stop(callback) {
  var self = this;

  async.each(Object.keys(self._gateways), function(gatewayId, callback) {
    self._gateways[gatewayId].close(callback);
  }, callback);
}
GatewayDriver.prototype.stop = stop;

function destroyGateway(gatewayId, callback) {
  this._gateways[gatewayId].close(callback);
  this._gateways[gatewayId] = null;
}
GatewayDriver.prototype.destroyGateway = destroyGateway;

module.exports = GatewayDriver;
