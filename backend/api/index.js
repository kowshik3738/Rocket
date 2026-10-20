/**
 * Vercel Serverless Function entry point for Rocket Notification Backend.
 * Automatically delegates HTTP requests to the Express application.
 */
const app = require('../server');

module.exports = app;
