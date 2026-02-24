import fs from "fs";
import fsp from "fs/promises";
import path from "path";

// File cache with TTL, LRU eviction, and optional fs.watch invalidation.
// API: configure(options), getJson(path[, {watch}]), getJsonSync(path[, {watch}]), clear(path?)

const DEFAULTS = { ttlMs: 0, maxEntries: 1000, watch: false };
let options = { ...DEFAULTS };

// cache: Map<resolvedPath, { value, expiresAt?: number }>
const cache = new Map();
const watchers = new Map();
const dirWatchers = new Map();

const PROJECT_CONFIGS_DIR = path.resolve(process.cwd(), "configs");

function resolvePath(p) {
  if (path.isAbsolute(p)) return p;
  return path.resolve(process.cwd(), p);
}

function enforceMaxEntries() {
  while (cache.size > options.maxEntries) {
    // delete oldest (Map preserves insertion order)
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
    closeWatcher(oldestKey);
  }
}

function enableWatch(rp) {
  if (watchers.has(rp)) return;
  try {
    const w = fs.watch(rp, () => {
      // invalidate on change
      cache.delete(rp);
      closeWatcher(rp);
    });
    watchers.set(rp, w);
  } catch (err) {
    console.warn('[WATCH_SETUP_ERROR]', rp, 'watch not supported or permission denied:', err.message);
  }
}

function closeWatcher(rp) {
  const w = watchers.get(rp);
  if (!w) return;
  try { w.close(); } catch (e) { console.error('[WATCHER_CLOSE_ERROR]', rp, e.message); }
  watchers.delete(rp);
}

function enableDirWatch(dir) {
  if (dirWatchers.has(dir)) return;
  let watcher = null;
  try {
    watcher = fs.watch(dir, (eventType, filename) => {
      if (!filename) return;
      const changed = resolvePath(path.join(dir, filename));
      
      // Check all cached keys for matches
      const keysToInvalidate = [];
      for (const key of cache.keys()) {
        if (key === changed || key.startsWith(dir + path.sep)) {
          keysToInvalidate.push(key);
        }
      }
      
      // Invalidate matched keys
      keysToInvalidate.forEach(key => {
        cache.delete(key);
        closeWatcher(key);
      });
    });
    dirWatchers.set(dir, watcher);
  } catch (err) {
    // Ensure watcher is closed on error
    if (watcher) {
      try { watcher.close(); } catch (e) { /* ignore */ }
    }
    console.warn('[DIR_WATCH_ERROR]', dir, err.message);
  }
}

function closeDirWatcher(dir) {
  const w = dirWatchers.get(dir);
  if (!w) return;
  try { w.close(); } catch (e) { console.error('[DIR_WATCHER_CLOSE_ERROR]', dir, e.message); }
  dirWatchers.delete(dir);
}

async function loadJson(rp) {
  const raw = await fsp.readFile(rp, "utf8");
  return JSON.parse(raw);
}

async function getJson(p, opts = {}) {
  const rp = resolvePath(p);
  const now = Date.now();

  let entry = cache.get(rp);
  if (entry) {
    if (options.ttlMs > 0 && entry.expiresAt && entry.expiresAt <= now) {
      cache.delete(rp);
      closeWatcher(rp);
      entry = null;
    } else {
      // Return cached entry immediately without LRU update (faster)
      return entry.value;
    }
  }

  const parsed = await loadJson(rp);
  const newEntry = { value: parsed };
  if (options.ttlMs > 0) newEntry.expiresAt = now + options.ttlMs;
  cache.set(rp, newEntry);
  enforceMaxEntries();
  if (options.watch || opts.watch) enableWatch(rp);
  // automatically enable dir-watching for top-level `configs` directory
  try {
    if (rp === PROJECT_CONFIGS_DIR || rp.startsWith(PROJECT_CONFIGS_DIR + path.sep)) {
      enableDirWatch(PROJECT_CONFIGS_DIR);
    }
  } catch (e) {}
  return parsed;
}

function getJsonSync(p, opts = {}) {
  const rp = resolvePath(p);
  const now = Date.now();

  let entry = cache.get(rp);
  if (entry) {
    if (options.ttlMs > 0 && entry.expiresAt && entry.expiresAt <= now) {
      cache.delete(rp);
      closeWatcher(rp);
      entry = null;
    } else {
      // Return cached entry immediately without LRU update (faster)
      return entry.value;
    }
  }

  const raw = fs.readFileSync(rp, "utf8");
  const parsed = JSON.parse(raw);
  const newEntry = { value: parsed };
  if (options.ttlMs > 0) newEntry.expiresAt = now + options.ttlMs;
  cache.set(rp, newEntry);
  enforceMaxEntries();
  if (options.watch || opts.watch) enableWatch(rp);
  try {
    if (rp === PROJECT_CONFIGS_DIR || rp.startsWith(PROJECT_CONFIGS_DIR + path.sep)) {
      enableDirWatch(PROJECT_CONFIGS_DIR);
    }
  } catch (e) {}
  return parsed;
}

function clear(pathLike) {
  if (pathLike) {
    const rp = resolvePath(pathLike);
    cache.delete(rp);
    closeWatcher(rp);
  } else {
    cache.clear();
    for (const k of watchers.keys()) closeWatcher(k);
    for (const d of dirWatchers.keys()) closeDirWatcher(d);
  }
}

function configure(opts = {}) {
  options = { ...options, ...opts };
  enforceMaxEntries();
}

function stats() {
  return { size: cache.size, watchers: watchers.size, dirWatchers: dirWatchers.size, options: { ...options } };
}

export default { configure, getJson, getJsonSync, clear, stats };
