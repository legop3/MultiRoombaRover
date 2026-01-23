const http = require('http');
const express = require('express');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const { parseCookieHeader } = require('../helpers/cookieParser');

const VISITOR_COOKIE = 'roverd_visitor';
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const app = express();
app.use(morgan('dev'));
app.use(express.json());
app.use((req, res, next) => {
  const cookies = parseCookieHeader(req.headers?.cookie || '');
  let token = cookies[VISITOR_COOKIE];
  if (!token) {
    token = uuidv4();
    const cookie = `${VISITOR_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${VISITOR_COOKIE_MAX_AGE}`;
    res.setHeader('Set-Cookie', cookie);
  }
  req.visitorToken = token;
  next();
});
app.use(express.static(config.staticDir, { index: false }));

const httpServer = http.createServer(app);

module.exports = { app, httpServer };
