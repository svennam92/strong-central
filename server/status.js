var os = require('os');

module.exports = status;

function status(server) {
  return statusFn;

  function statusFn(req, res) {
    res.status(200).json(statusMessage(server));
  }
}

function statusMessage(server) {
  // TODO: fill this in with more meaningful information
  return {
    loadavg: os.loadavg(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    driver: server.driverName(),
    accepting: !!server.getHttpServer().address(),
  };
}
