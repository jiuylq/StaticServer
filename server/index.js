const config = require('./config.js');
const StaticServer = require('./app.js');

const server = new StaticServer(config);
server.start();
