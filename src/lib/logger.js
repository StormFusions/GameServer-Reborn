import pino from 'pino';
import pinoHttp from 'pino-http';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const base = {
  pid: process.pid,
  hostname: os.hostname(),
  service: 'tsto-server',
};

function genReqId(req) {
  // Prefer incoming header, otherwise create one
  return req.headers['x-request-id'] || uuidv4();
}

// Development: use pino-pretty for readable console output
const isProd = process.env.NODE_ENV === 'production';

let logger;
if (!isProd) {
  // Use pino transport with pino-pretty for developer-friendly logs
  try {
    const transport = pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        singleLine: true,
        ignore: 'pid,hostname,service',
      },
    });
    logger = pino({
      level: process.env.LOG_LEVEL || 'debug',
      base,
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: { err: pino.stdSerializers.err },
    }, transport);
  } catch (e) {
    // Fall back to plain pino if transport not available
    logger = pino({
      level: process.env.LOG_LEVEL || 'debug',
      base,
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: { err: pino.stdSerializers.err },
    });
  }
} else {
  logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: pino.stdSerializers.err },
  });
}

const httpLogger = pinoHttp({
  logger,
  genReqId,
  autoLogging: false,
});

// Ensure all pino logs are also appended to latest.log for the dashboard
const LOG_PATH = path.resolve(process.cwd(), 'latest.log');

function appendLineToLatest(line) {
  // Best-effort, do not block
  fsp.appendFile(LOG_PATH, line + '\n').catch(() => {});
}

// Wrap the logger methods to also append a human-friendly line to the log file
const levelsToWrap = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
for (const lvl of levelsToWrap) {
  if (typeof logger[lvl] === 'function') {
    const orig = logger[lvl].bind(logger);
    logger[lvl] = (...args) => {
      // Skip dashboard and userdash logs to reduce noise
      if (args.length > 0) {
        const firstArg = args[0];
        if (typeof firstArg === 'string' && (firstArg.includes('/dashboard') || firstArg.includes('/userdash'))) {
          return;
        }
        if (typeof firstArg === 'object' && firstArg?.url && (firstArg.url.includes('/dashboard') || firstArg.url.includes('/userdash'))) {
          return;
        }
      }
      if (args.length > 1) {
        const secondArg = args[1];
        if (typeof secondArg === 'string' && (secondArg.includes('/dashboard') || secondArg.includes('/userdash'))) {
          return;
        }
      }

      try {
        // Call original logger
        orig(...args);
      } catch (e) {
        console.error('Logger error:', e);
      }

      try {
        // Format a compact message for the file
        let msg = '';
        if (args.length === 1) {
          if (typeof args[0] === 'string') msg = args[0];
          else if (typeof args[0] === 'object') msg = JSON.stringify(args[0]);
        } else if (args.length >= 2) {
          const [maybeObj, maybeMsg] = args;
          if (typeof maybeMsg === 'string') msg = maybeMsg;
          else if (typeof maybeObj === 'string') msg = maybeObj;
          else msg = JSON.stringify(maybeObj);
        }

        const time = new Date().toLocaleTimeString();
        const line = `[${time}] ${lvl.toUpperCase()} ${msg}`;
        appendLineToLatest(line);
      } catch (e) {
        console.error('Logger file write error:', e);
      }
    };
  }
}

function formatCompactRequest(req, res, durationMs) {
  const id = req.id || req.headers['x-request-id'] || '';
  const method = req.method;
  const url = req.originalUrl || req.url;
  const status = res.statusCode;
  const remote = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';
  const client = req.headers['mh_client_version'] || req.headers['client_version'] || '';

  // Build a compact human-friendly message similar to old console output
  const short = `[${new Date().toLocaleTimeString()}] ${method} ${url} [${status}] ${durationMs}ms`;

  const meta = { reqId: id, method, url, status, durationMs, remote, ua, client };
  logger.info(meta);
}

// Client connection issue tracking middleware (to be attached in index.js)
function setupClientConnectionTracking() {
  return (req, res, next) => {
    const startTime = Date.now();
    const reqId = req.id || req.headers['x-request-id'] || '';
    
    // Track client aborts
    req.on('aborted', () => {
      const duration = Date.now() - startTime;
      console.error(`[ABORT] ${req.method} ${req.originalUrl || req.url} - duration: ${duration}ms`);
      logger.warn({
        reqId,
        method: req.method,
        url: req.originalUrl || req.url,
        duration,
        remote: req.ip || req.socket?.remoteAddress,
        reason: 'CLIENT_ABORT'
      }, 'CLIENT ABORT: Request terminated by client');
    });

    // Track socket errors
    req.socket?.on('error', (err) => {
      console.error(`[SOCKET_ERROR] ${req.method} ${req.originalUrl || req.url} - ${err.code}: ${err.message}`);
      logger.error({
        reqId,
        method: req.method,
        url: req.originalUrl || req.url,
        remote: req.ip || req.socket?.remoteAddress,
        error: err.code || err.message
      }, 'SOCKET ERROR: Connection issue with client');
    });

    // Track response errors
    res.on('error', (err) => {
      const duration = Date.now() - startTime;
      console.error(`[RESPONSE_ERROR] ${req.method} ${req.originalUrl || req.url} [${res.statusCode}] - ${err.message}`);
      logger.error({
        reqId,
        method: req.method,
        url: req.originalUrl || req.url,
        status: res.statusCode,
        duration,
        error: err.message
      }, 'RESPONSE ERROR: Failed to send response to client');
    });

    // Log when response finishes with non-2xx status (skip 401s on userdash - expected for unauthenticated requests)
    res.once('finish', () => {
      const isUnauthenticatedUserdash = res.statusCode === 401 && req.originalUrl?.includes('/userdash/api/');
      if (res.statusCode >= 400 && !isUnauthenticatedUserdash) {
        const duration = Date.now() - startTime;
        console.error(`[HTTP_ERROR] ${req.method} ${req.originalUrl || req.url} [${res.statusCode}] - ${duration}ms`);
        logger.warn({
          reqId,
          method: req.method,
          url: req.originalUrl || req.url,
          status: res.statusCode,
          duration,
          remote: req.ip || req.socket?.remoteAddress,
          ua: req.headers['user-agent']
        }, `CLIENT ERROR RESPONSE: ${res.statusCode}`);
      }
    });

    next();
  };
}

// Global error handlers for uncaught exceptions and unhandled rejections
function setupGlobalErrorHandlers() {
  process.on('uncaughtException', (err) => {
    logger.fatal({ err, stack: err.stack }, 'UNCAUGHT EXCEPTION - Server will exit');
    logger.error(err, "UNCAUGHT EXCEPTION:");
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'UNHANDLED PROMISE REJECTION');
    console.error('UNHANDLED REJECTION:', reason);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received - gracefully shutting down');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received - gracefully shutting down');
    process.exit(0);
  });
}

export { logger, httpLogger, formatCompactRequest, setupGlobalErrorHandlers, setupClientConnectionTracking };
