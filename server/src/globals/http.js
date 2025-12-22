const path = require('path');
const http = require('http');
const express = require('express');
const morgan = require('morgan');
const config = require('./config');

const app = express();
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(config.staticDir));
app.get('/spectate', (req, res) => {
  res.sendFile(path.join(config.staticDir, 'index.html'));
});
app.get('/mini', (req, res) => {
  res.sendFile(path.join(config.staticDir, 'index.html'));
});

const httpServer = http.createServer(app);

module.exports = { app, httpServer };
