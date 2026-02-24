import sqlite3 from "sqlite3";
import config from "../../config.json" with { type: "json" };

const db = new sqlite3.Database(
  config.dataDirectory + "/users.db",
  sqlite3.OPEN_READWRITE,
  (error) => {
    if (error) {
      console.error("Error opening database:", error.message);
    }
  },
);

// Prevent EventEmitter memory leak warning - increase max listeners for database connections
db.setMaxListeners(50);

// Optimize database for faster queries and concurrent connections
db.configure("busyTimeout", 5000); // Wait up to 5s for locks instead of failing
db.run("PRAGMA journal_mode = WAL"); // Write-Ahead Logging for better concurrency
db.run("PRAGMA synchronous = NORMAL"); // Balance safety and speed
db.run("PRAGMA cache_size = -64000"); // 64MB cache (negative = MB instead of pages)
db.run("PRAGMA query_only = FALSE"); // Allow writes
db.run("PRAGMA temp_store = MEMORY"); // Use memory for temp tables
db.run("PRAGMA mmap_size = 30000000"); // Memory-mapped I/O for faster reads

// Flag to pause database operations
let isPaused = false;

export function pauseDatabase() {
  return new Promise((resolve) => {
    // Use TRUNCATE mode checkpoint which aggressively flushes and closes WAL
    db.run("PRAGMA wal_checkpoint(TRUNCATE)", (err) => {
      if (err) {
        console.warn("Warning: Could not checkpoint WAL:", err.message);
      }
      
      // Force close the database to release all file handles
      db.close((closeErr) => {
        if (closeErr) {
          console.warn("Warning: Could not close database:", closeErr.message);
        }
        isPaused = true;
        console.log("Database closed for restore (all file handles released)");
        resolve();
      });
    });
  });
}

export function resumeDatabase() {
  // Just clear the pause flag - the database will be fully reopened
  // when the server process restarts (which the user should do after restore)
  isPaused = false;
  console.log("Pause flag cleared - server restart required to reopen database");
}

export function isDatabasePaused() {
  return isPaused;
}

// --- Promisified database operations ---

export const dbGet = (sql, params = []) => new Promise((resolve, reject) =>
  db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r)))
);

export const dbAll = (sql, params = []) => new Promise((resolve, reject) =>
  db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r)))
);

export const dbRun = (sql, params = []) => new Promise((resolve, reject) =>
  db.run(sql, params, function (e) {
    e ? reject(e) : resolve(this);
  })
);

// --- Query result cache ---

const queryCache = new Map();
const QUERY_CACHE_TTL = 5000; // 5 seconds

export function getCachedQuery(key, sqlQuery, params, ttl = QUERY_CACHE_TTL) {
  return new Promise(async (resolve, reject) => {
    const now = Date.now();
    const cached = queryCache.get(key);
    if (cached && cached.expiresAt > now) return resolve(cached.data);
    try {
      const data = await dbGet(sqlQuery, params);
      queryCache.set(key, { data, expiresAt: now + ttl });
      resolve(data);
    } catch (err) {
      reject(err);
    }
  });
}

export function getCachedQueryAll(key, sqlQuery, params, ttl = QUERY_CACHE_TTL) {
  return new Promise(async (resolve, reject) => {
    const now = Date.now();
    const cached = queryCache.get(key);
    if (cached && cached.expiresAt > now) return resolve(cached.data);
    try {
      const data = await dbAll(sqlQuery, params);
      queryCache.set(key, { data, expiresAt: now + ttl });
      resolve(data);
    } catch (err) {
      reject(err);
    }
  });
}

export function invalidateQueryCache(pattern) {
  if (pattern) {
    for (const [key] of queryCache) {
      if (key.includes(pattern)) queryCache.delete(key);
    }
  } else {
    queryCache.clear();
  }
}

// Periodic cleanup of expired cache entries (every 60 seconds)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of queryCache) {
    if (entry.expiresAt <= now) queryCache.delete(key);
  }
}, 60000);

export default db;
