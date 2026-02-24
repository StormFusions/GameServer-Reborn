import express from "express";
import routes from "./routes/routes.js";

import compression from "compression";

import chalk from "chalk";
import { debugWithTime } from "./util/debugUtil.js";

import "dotenv/config";
import config from "../config.json" with { type: "json" };

import fs from "fs";
import path from "path";
import fsp from "fs/promises";
import { dbGet, dbAll, dbRun } from "./lib/db.js";
import backupManager from "./lib/backupManager.js";
import client from "prom-client";
import { logger, httpLogger, formatCompactRequest, setupGlobalErrorHandlers, setupClientConnectionTracking } from "./lib/logger.js";

// Reset log (use absolute path so behavior is consistent regardless of cwd)
const LOG_PATH = path.resolve(process.cwd(), "latest.log");
if (fs.existsSync(LOG_PATH)) fs.rmSync(LOG_PATH);

const app = express();
const PORT = process.env.LISTEN_PORT || config.listenPort;

// Prevent EventEmitter memory leak warnings for high-concurrency servers
app.setMaxListeners(50);
process.setMaxListeners(50);

// Centralized logger (also set for backwards compatibility)
global.logger = logger;

// Migrate existing users: initialize LandSavePath and CurrencySavePath for users that don't have them
const migrateUserDataPaths = async () => {
  try {
    // Find users without LandSavePath or CurrencySavePath
    const usersToMigrate = await dbAll(
      "SELECT UserId, MayhemId FROM UserData WHERE LandSavePath IS NULL OR CurrencySavePath IS NULL",
      []
    );

    if (!usersToMigrate || usersToMigrate.length === 0) {
      logger.info("No users need data path migration");
      return;
    }

    logger.info({ count: usersToMigrate.length }, "Starting data path migration for existing users");

    // Find a template land file to copy
    let templateLandPath = null;
    const dataDir = config.dataDirectory || "data";
    try {
      const dirs = await fsp.readdir(dataDir);
      for (const dir of dirs) {
        const fullPath = path.join(dataDir, dir);
        const stats = await fsp.stat(fullPath);
        if (stats.isDirectory()) {
          const landFile = path.join(fullPath, `${dir}.land`);
          try {
            await fsp.stat(landFile);
            templateLandPath = landFile;
            logger.info({ templateLandPath }, "Found template land file for migration");
            break;
          } catch (e) {
            // This directory doesn't have a land file, try next
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, "Error finding template land file");
    }

    // Migrate each user
    let successCount = 0;
    for (const user of usersToMigrate) {
      try {
        const userDataDir = path.join(dataDir, user.MayhemId);
        const landSavePath = path.posix.join(dataDir, user.MayhemId, `${user.MayhemId}.land`);
        const currencySavePath = path.posix.join(dataDir, user.MayhemId, `${user.MayhemId}.currency`);

        // Create directory if it doesn't exist
        await fsp.mkdir(userDataDir, { recursive: true });

        // Copy template land file if available
        if (templateLandPath && !fs.existsSync(userDataDir)) {
          try {
            await fsp.copyFile(templateLandPath, path.join(userDataDir, `${user.MayhemId}.land`));
          } catch (err) {
            logger.warn({ err, user: user.MayhemId }, "Error copying template land file");
          }
        }

        // Create empty currency file if it doesn't exist
        try {
          const currencyFilePath = path.join(userDataDir, `${user.MayhemId}.currency`);
          if (!fs.existsSync(currencyFilePath)) {
            await fsp.writeFile(currencyFilePath, Buffer.alloc(0));
          }
        } catch (err) {
          logger.warn({ err, user: user.MayhemId }, "Error creating currency file");
        }

        // Update database with paths (always use forward slashes for consistency)
        const UPDATE_QUERY = `UPDATE UserData SET LandSavePath = ?, CurrencySavePath = ? WHERE MayhemId = ?`;
        await dbRun(UPDATE_QUERY, [landSavePath, currencySavePath, user.MayhemId]);
        successCount++;
      } catch (err) {
        logger.error({ err, user: user.MayhemId }, "Error migrating user data paths");
      }
    }

    logger.info({ successCount, totalCount: usersToMigrate.length }, "User data path migration completed");
  } catch (error) {
    logger.error({ err: error }, "Error in user data path migration");
  }
};

// Run data path migration on startup
setTimeout(() => {
  migrateUserDataPaths();
}, 1000);

// Prometheus metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [register],
});
const httpRequestDurationMs = new client.Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in ms",
  labelNames: ["method", "route", "status"],
  buckets: [10, 50, 100, 200, 500, 1000, 2000],
  registers: [register],
});
const connectedUsersGauge = new client.Gauge({
  name: "connected_users",
  help: "Approximate connected users (tracked tokens)",
  registers: [register],
});

// Attach pino-http to populate `req.log` and `req.id`
// Skip logging for dashboard requests to reduce noise
app.use((req, res, next) => {
  // Skip httpLogger for dashboard and userdash requests
  if (req.url.startsWith('/dashboard') || req.url.startsWith('/userdash')) {
    return next();
  }
  httpLogger(req, res, next);
});

// Track client connection issues (aborts, socket errors, etc.)
app.use(setupClientConnectionTracking());

// Metrics middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.once("finish", () => {
    const duration = Date.now() - start;
    const route = req.route && req.route.path ? req.route.path : req.originalUrl || req.url;
    const labels = { method: req.method, route: route, status: String(res.statusCode) };
    try {
      httpRequestsTotal.inc(labels, 1);
      httpRequestDurationMs.observe(labels, duration);
      connectedUsersGauge.set(global.connectedUsers ? global.connectedUsers.size : 0);
      // Skip logging for dashboard and userdash requests to reduce noise
      if (!req.url.startsWith('/dashboard') && !req.url.startsWith('/userdash')) {
        // Emit a compact human-friendly request line for developers
        try { formatCompactRequest(req, res, duration); } catch (e) { console.error('[FORMAT_REQUEST_ERROR]', e.message); }
      }
    } catch (e) {
      console.error('[METRICS_ERROR]', e.message);
      logger.debug({ err: e }, "metrics update failed");
    }
  });
  next();
});

// Normalize URLs with double slashes (//director -> /director)
app.use((req, res, next) => {
  if (req.url.startsWith("//")) {
    req.url = req.url.replace(/^\/+/, "/");
    req.originalUrl = req.originalUrl.replace(/^\/+/, "/");
    logger.debug({ originalUrl: req.originalUrl, normalizedUrl: req.url }, "Normalized double-slash URL");
  }
  next();
});

// Expose /metrics endpoint
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    logger.error({ err }, "failed to collect metrics");
    res.status(500).send("metrics error");
  }
});

// Track recent active tokens to estimate "connected users" for the dashboard.
global.connectedUsers = new Map(); // token -> lastSeenTimestamp
global.connectionTimeoutMs = 5 * 60 * 1000; // consider active within last 5 minutes

function parseCookieHeader(cookieHeader, name) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const c of cookies) {
    const [k, ...v] = c.split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Lightweight middleware to record activity for requests that include a token
// Optimized: lazy cleanup only every 100 requests to reduce overhead
let requestCount = 0;
app.use((req, res, next) => {
  try {
    const token = req.headers['nucleus_token'] || req.headers['mh_auth_params'] || req.headers['access_token'] || parseCookieHeader(req.headers.cookie, 'userToken');
    if (token) {
      global.connectedUsers.set(token, Date.now());
    }

    // Periodic cleanup of stale entries (every 100 requests instead of every request)
    if (++requestCount % 100 === 0) {
      const now = Date.now();
      for (const [k, ts] of global.connectedUsers) {
        if (now - ts > global.connectionTimeoutMs) {
          global.connectedUsers.delete(k);
        }
      }
    }
  } catch (err) {
    // don't block requests on errors here
    logger.debug('connectedUsers middleware error');
  }
  next();
});

// Disable unnecessary Express features
app.disable("x-powered-by");
app.disable("etag");

// Setup Pug
app.set("view engine", "pug");
app.set("views", "./src/views");

app.use((req, res, next) => {
  res.on("finish", () => {
    // Only log errors and non-200s; skip verbose logging for successful requests
    if ((res.statusCode < 200 || res.statusCode >= 400) || config.verbose) {
      debugWithTime(0, chalk.blue(req.method) + ` ${req.originalUrl} ` + chalk.magenta(`[${res.statusCode}]`));
      if (config.verbose || res.statusCode >= 400) {
        logger.debug({ method: req.method, url: req.originalUrl, status: res.statusCode }, "request");
      }
    }
  });
  next();
});

app.use(
  compression({
    filter: (req, res) => {
      try {
        const accept = (req.headers && req.headers.accept) ? req.headers.accept : '';
        if (accept.includes('text/event-stream')) return false; // do not compress SSE
        if (accept.includes('image/') || accept.includes('video/')) return false; // skip already compressed media
      } catch (err) { console.error('[COMPRESSION_FILTER_ERROR]', err.message); }
      return compression.filter(req, res);
    },
    threshold: 1024, // Only compress responses larger than 1KB to save CPU
    level: 6, // Good balance between compression ratio and CPU usage
  }),
);

// Add JSON body parsing middleware with size limit
app.use(express.json({ limit: '1mb' }));

// Add CORS headers middleware for API responses (Springfield format)
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, nucleus_token, mh_auth_params, X-Requested-With, X-Api-Version, X-Application-Key, X-AuthToken');
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Access-Control-Max-Age', '3600');
  next();
});

// Add global error handler for body parsing errors BEFORE routes
app.use((err, req, res, next) => {
  if (err.status === 413 || err.code === 'ENTITY_TOO_LARGE') {
    logger.warn({ 
      url: req.originalUrl, 
      method: req.method, 
      contentLength: req.get('content-length'),
      error: err.message 
    }, "Payload too large");
    res.status(413).json({ error: 'Payload too large' });
    return;
  }
  if (err.status === 400 || err.code === 'INVALID_CONTENT_TYPE') {
    logger.warn({ 
      url: req.originalUrl, 
      method: req.method,
      contentType: req.get('content-type'),
      error: err.message 
    }, "Bad request - likely body parsing error");
  }
  next(err);
});

// Selective logging for POST requests - only log in verbose mode to reduce overhead
app.post("*", (req, res, next) => {
  if (config.verbose) {
    const url = req.originalUrl || req.url;
    logger.debug({ 
      method: "POST",
      path: url,
      contentType: req.get("content-type")
    }, "POST request");
  }
  next();
});

app.use(routes);

if (config.serveDlcsLocally) {
  debugWithTime(0, "Serving DLCs from local directory: " + config.localDlcFolder);

  if (!fs.existsSync(config.localDlcFolder)) {
    fs.mkdirSync("." + config.localDlcFolder, { recursive: true });
  }

  app.use(config.localDlcFolder, express.static("." + config.localDlcFolder));
} else {
  debugWithTime(1, "DLCs will not be served from a local directory.");
}

app.get("/", (req, res) => {
  res.send("Hello, World!");
});

app.use((req, res) => {
  // Only log unmatched requests in debug mode to avoid spam
  if (config.verbose) {
    logger.debug({
      method: req.method,
      url: req.originalUrl,
      path: req.path
    }, "Unmatched request");
  }
  res.status(404).send("Do'h! Error 404");
});

app.use((err, req, res, next) => {
  // Avoid logging full error object; extract only relevant info
  logger.error({ code: err.code, message: err.message }, "Unhandled error");
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).send("Do'h! Error 500");
});

// Setup global error handlers before starting server
setupGlobalErrorHandlers();

const server = app.listen(PORT, () => { 
  debugWithTime(0, `Listening on port ${PORT}`);
  logger.info({ port: PORT }, "Listening");
  global.running = true; // For the dashboard
  global.lobbyTime = 0; // 0 for current time

  // Set max listeners on server socket to prevent memory leak warnings
  server.setMaxListeners(50);
  server.on('connection', (socket) => {
    socket.setMaxListeners(50);
  });

  // Initialize and start backup manager
  try {
    const backupConfig = {
      dataDirectory: config.dataDirectory || "data",
      backupDirectory: config.backupDirectory || "backups",
      maxBackups: config.maxBackups || 10,
      backupInterval: config.backupInterval || 3600000, // Default: 1 hour
    };

    // Reinitialize backup manager with config
    Object.assign(backupManager, backupConfig);
    backupManager.initBackupDir();
    backupManager.startAutoBackup();

    logger.info(
      { 
        interval: `${backupManager.backupInterval / 1000 / 60} minutes`,
        maxBackups: backupManager.maxBackups,
        backupDir: backupManager.backupDir
      },
      "Automatic backup system started"
    );
  } catch (error) {
    logger.error(error, "Failed to initialize backup system");
  }
});
