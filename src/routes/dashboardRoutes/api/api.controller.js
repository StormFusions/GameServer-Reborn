import { Router, json } from "express";

import fileUpload from "express-fileupload";

import db, { dbGet, dbAll, dbRun } from "../../../lib/db.js";

import pb from "../../../lib/protobuf.js";
import fs from "fs";
import fsp from "fs/promises";
import fileCache from "../../../lib/fileCache.js";
import backupManager from "../../../lib/backupManager.js";

import config from "../../../../config.json" with { type: "json" };
import path from "path";
import { logger } from "../../../lib/logger.js";
import sessionManager from "../../../lib/sessionManager.js";


const router = Router();

router.use(json());

// -- Players -- \\

router.get("/players/current", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const activePlayers = sessionManager.getAllActiveSessions();
      const stats = sessionManager.getStatistics();
      
      res.json({
        success: true,
        data: {
          players: activePlayers,
          statistics: stats,
          timestamp: Date.now()
        }
      });
    } else {
      res.status(401).json({ success: false, error: "Invalid or Empty Key" });
    }
  } catch (error) {
    next(error);
  }
});

router.get("/players/count", async (req, res, next) => {
  try {
    const count = sessionManager.getActivePlayerCount();
    
    res.json({
      success: true,
      data: count,
      timestamp: Date.now()
    });
  } catch (error) {
    next(error);
  }
});

router.get("/players/statistics", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const stats = sessionManager.getStatistics();
      
      res.json({
        success: true,
        data: stats,
        timestamp: Date.now()
      });
    } else {
      res.status(401).json({ success: false, error: "Invalid or Empty Key" });
    }
  } catch (error) {
    next(error);
  }
});

// -- General -- \\

router.get("/general/statistics", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      // Compute connected users by counting tokens seen within connectionTimeoutMs
      try {
        const timeout = global.connectionTimeoutMs || 5 * 60 * 1000;
        const now = Date.now();
        let count = 0;
        if (global.connectedUsers) {
          for (const ts of global.connectedUsers.values()) {
            if (now - ts <= timeout) count++;
          }
        }

        res.json({
          status: global.running ? "Online" : "Offline",
          uptime: process.uptime(),
          connectedUsers: count,
        });
      } catch (err) {
        logger.error(err, 'Error computing connectedUsers:');
        res.json({
          status: global.running ? "Online" : "Offline",
          uptime: process.uptime(),
          connectedUsers: 0,
        });
      }
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/general/start", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      global.running = true;
      
      // Resume database operations - just clear the pause flag
      // Note: User should restart the Node process for database to actually reopen
      try {
        const { resumeDatabase } = await import("../../../lib/db.js");
        resumeDatabase();
      } catch (dbErr) {
        logger.error({ error: dbErr }, "Error resuming database");
      }
      
      res.status(200).send("Started Server");
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/general/stop", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      global.running = false;
      
      // Pause database operations to prevent file locks during restore
      try {
        const { pauseDatabase } = await import("../../../lib/db.js");
        await db.all("PRAGMA optimize"); // Flush any pending data
        await pauseDatabase(); // Wait for WAL checkpoint to complete
      } catch (dbErr) {
        logger.error({ error: dbErr }, "Error pausing database");
        // Still proceed with stop even if DB pause fails
      }
      
      res.status(200).send("Stopped Server");
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

// -- Event -- \\

router.post("/event/set", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const { timestamp } = req.body;
      // Attempt to resolve the current lobbyTime to a known event name
      let eventName = null;
      try {
        const lt = Number(global.lobbyTime) || 0;
        if (lt && lt !== 0) {
          const lobbySeconds = lt > 1e11 ? Math.floor(lt / 1000) : lt;
          const eventsObj = await fileCache.getJson(path.resolve("src/routes/dashboardRoutes/assets/events.json"));
          const flat = Object.values(eventsObj).flat();
          const found = flat.find((e) => Number(e.timestamp) === Number(lobbySeconds));
          if (found) eventName = found.name;
        }
      } catch (err) {
        logger.error(err, 'Could not resolve lobbyTime to event name:');
      }

      res.json({
        lobbyTime: global.lobbyTime,
        eventName: eventName,
      });
      let resolved = null;
      try {
        const eventsObj = await fileCache.getJson(path.resolve("src/routes/dashboardRoutes/assets/events.json"));
        const flat = Object.values(eventsObj).flat();
        resolved = flat.find((e) => Number(e.timestamp) === Number(timestamp));
      } catch (err) {
        logger.error(err, "Could not resolve event metadata:");
      }

      // Normalize timestamp and set `global.lobbyTime` (seconds -> ms when needed).
      let ts = Number(timestamp) || 0;
      if (ts > 0 && ts < 1e11) ts = ts * 1000; // seconds -> ms
      global.lobbyTime = ts;

      // Attempt to resolve a friendly event name for the set time
      let resolvedName = null;
      try {
        const lt = Number(global.lobbyTime) || 0;
        if (lt && lt !== 0) {
          const lobbySeconds = lt > 1e11 ? Math.floor(lt / 1000) : lt;
          const eventsObj = await fileCache.getJson(path.resolve("src/routes/dashboardRoutes/assets/events.json"));
          const flat = Object.values(eventsObj).flat();
          const found = flat.find((e) => Number(e.timestamp) === Number(lobbySeconds));
          if (found) resolvedName = found.name;
        }
      } catch (err) {
        logger.error(err, 'Could not resolve lobbyTime to event name:');
      }

      logger.info(`[dashboard/api/event/set] lobbyTime set to ${global.lobbyTime} (${new Date(Number(global.lobbyTime)).toISOString()}) resolvedName=${resolvedName}`);
      if (!res.headersSent) res.json({ lobbyTime: global.lobbyTime, eventName: resolvedName });
    } else {
      if (!res.headersSent) res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.get("/event/get", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      if (!res.headersSent) res.json({ lobbyTime: global.lobbyTime });
    } else {
      if (!res.headersSent) res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

// -- Users -- \\

router.post("/users/get", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {

      const page = req.body.page || 1;
      const pageSize = req.body.pageSize || 10;
      const query = req.body.query ? req.body.query: "";
      const offset = (page - 1) * pageSize;

      let params = [pageSize, offset];

      const ALL_USERS_QUERY = "SELECT UserName, UserEmail, MayhemId, UserId, LastPlayedTime FROM UserData LIMIT ? OFFSET ?;";
      const FILTERED_QUERY = "SELECT UserName, UserEmail, MayhemId, UserId, LastPlayedTime FROM UserData WHERE UserName LIKE ? OR UserEmail LIKE ? OR MayhemId LIKE ? OR CAST(UserId AS TEXT) LIKE ? LIMIT ? OFFSET ?;";

      let QUERY_TO_USE = ALL_USERS_QUERY;
      if (query !== "") {
        const likeQuery = `%${query}%`;
        QUERY_TO_USE = FILTERED_QUERY;
        params = [likeQuery, likeQuery, likeQuery, likeQuery, pageSize, offset];
      }

      const rows = await dbAll(QUERY_TO_USE, params);
      res.json({ data: rows });
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/users/update", async (req, res, next) => {

  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const { mayhemId, field, newValue } = req.body;

      const allowedFields = ['UserName', 'UserEmail', 'MayhemId', 'UserId'];
      if (!allowedFields.includes(field)) {
        return res.status(400).send("Invalid field");
      }

      await db.get(`UPDATE UserData SET ${field} = ? WHERE MayhemId = ?`, [newValue, mayhemId]);

      res.status(200).send("");
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (err) {
    logger.error(err);
    res.status(500).send("Internal error");
  }
});

router.post("/users/delete", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const { mayhemId } = req.body;

      const USER_BY_MAYHEMID = "SELECT 1 from UserData WHERE MayhemId = ?;";
      const user = await dbGet(USER_BY_MAYHEMID, [mayhemId]);
      
      if (!user) {
        res.status(400).send("No user found with that token");
        return;
      }

      const DELETE_USER_BY_MAYHEMID = "DELETE FROM UserData WHERE MayhemId = ?;";
      await dbRun(DELETE_USER_BY_MAYHEMID, [mayhemId]);

      if (fs.existsSync(config.dataDirectory + "/" + mayhemId))
        fs.rmSync(config.dataDirectory + "/" + mayhemId, { recursive: true, force: true });

      res.status(200).send("Deleted user");
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
    } catch (err) {
    logger.error(err);
    res.status(500).send("Internal error");
  }
});

// -- Savefiles -- \\

router.post("/savefiles/setDonuts", async (req, res, next) => {
  try {
    const UPDATE_QUERY = `
      UPDATE UserData
      SET CurrencySavePath = ?
      WHERE MayhemId = ?`;

    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      if (!req.body.donuts) return res.status(400).send("Amount of donuts not specified");
      const mayhemId = req.body.mayhemId ? req.body.mayhemId : "No MayhemId";

      const USERINFO_BY_MAYHEMID_QUERY = "SELECT CurrencySavePath, MayhemId from UserData WHERE MayhemId = ?;";
      const row = await dbGet(USERINFO_BY_MAYHEMID_QUERY, [mayhemId]);
      
      if (!row) {
        res.status(400).send("No user found with that MayhemId");
        return;
      }

      const CurrencyData = pb.lookupType("Data.CurrencyData");

      let savePath = row.CurrencySavePath;
      if (!savePath || savePath == "") {
        savePath = config.dataDirectory + `/${mayhemId}/${mayhemId}.currency`;
        const UPDATE_QUERY = "UPDATE UserData SET CurrencySavePath = ? WHERE MayhemId = ?";
        await dbRun(UPDATE_QUERY, [savePath, mayhemId]);
      }

      if (!fs.existsSync(config.dataDirectory + "/" + mayhemId))
        fs.mkdirSync(config.dataDirectory + "/" + mayhemId);

      let message = CurrencyData.create({
        id: mayhemId,
        vcTotalPurchased: 0,
        vcTotalAwarded: req.body.donuts,
        vcBalance: req.body.donuts,
        createdAt: 1715911362,
        updatedAt: Date.now(),
      });
      await fsp.writeFile(
        savePath,
        CurrencyData.encode(message).finish(),
      );

      res.status(200).send("Donuts updated");
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/savefiles/get", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {

      const page = req.body.page || 1;
      const pageSize = req.body.pageSize || 10;
      const query = req.body.query ? req.body.query: "";
      const offset = (page - 1) * pageSize;

      let params = [pageSize, offset];

      const ALL_USERS_QUERY = "SELECT UserName, UserEmail, MayhemId, CurrencySavePath FROM UserData LIMIT ? OFFSET ?;";
      const FILTERED_QUERY = "SELECT UserName, UserEmail, MayhemId, CurrencySavePath FROM UserData WHERE UserName LIKE ? OR UserEmail LIKE ? OR MayhemId LIKE ? OR CAST(UserId AS TEXT) LIKE ? LIMIT ? OFFSET ?;";

      let QUERY_TO_USE = ALL_USERS_QUERY;
      if (query !== "") {
        const likeQuery = `%${query}%`;
        QUERY_TO_USE = FILTERED_QUERY;
        params = [likeQuery, likeQuery, likeQuery, likeQuery, pageSize, offset];
      }

      const rows = await dbAll(QUERY_TO_USE, params);
      const CurrencyData = pb.lookupType("Data.CurrencyData");

      const usersWithDonuts = await Promise.all(rows.map(async (user) => {
        let donutCount = 0;

        if (user.CurrencySavePath) {
          try {
            // Check if file exists before trying to read it
            if (fs.existsSync(user.CurrencySavePath)) {
              const donutFile = await fsp.readFile(user.CurrencySavePath);
              const donutData = CurrencyData.decode(donutFile);
              donutCount = donutData.vcBalance;
            } else {
              // File doesn't exist, use default
              donutCount = config.startingDonuts;
            }
          } catch (err) {
            logger.error(err, "Error reading or parsing protobuf file:");
            // On error, fall back to default
            donutCount = config.startingDonuts;
          }
        } else {
          donutCount = config.startingDonuts;
        }

        return {
          UserName: user.UserName,
          UserEmail: user.UserEmail,
          MayhemId: user.MayhemId,
          DonutCount: donutCount,
        };
      }));

      res.json({ data: usersWithDonuts });

    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/savefiles/upload", fileUpload(), async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {

      if (!req.files?.town) return res.status(400).send("No town uploaded");
      const mayhemId = req.body.mayhemId ? req.body.mayhemId : "No MayhemId";

      const USERINFO_BY_MAYHEMID_QUERY = "SELECT LandSavePath, MayhemId from UserData WHERE MayhemId = ?;";
      const row = await dbGet(USERINFO_BY_MAYHEMID_QUERY, [mayhemId]);
      
      if (!row) {
        res.status(400).send("No user found with that MayhemId");
        return;
      }

      let savePath = row.LandSavePath;
      if (!savePath) {
        savePath = `${config.dataDirectory}/${row.MayhemId}/${row.MayhemId}.land`;
        const UPDATE_QUERY = `UPDATE UserData SET LandSavePath = ? WHERE MayhemId = ?`;
        await dbRun(UPDATE_QUERY, [savePath, row.MayhemId]);
      }

      if (!fs.existsSync(config.dataDirectory + "/" + row.MayhemId))
        fs.mkdirSync(config.dataDirectory + "/" + row.MayhemId);

      const town = req.files.town;
      await new Promise((resolve, reject) => {
        town.mv(savePath, (err) => {
          if (err) {
            logger.error(err, "File move error:");
            reject(err);
          } else {
            resolve();
          }
        });
      });

      res.status(200).send("Town uploaded");
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.get("/savefiles/export", fileUpload(), async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {

      const mayhemId = req.query.mayhemId ? req.query.mayhemId : "No MayhemId";

      const USERINFO_BY_MAYHEMID_QUERY = "SELECT LandSavePath from UserData WHERE MayhemId = ?;";
      const row = await dbGet(USERINFO_BY_MAYHEMID_QUERY, [mayhemId]);
      
      if (!row) {
        res.status(400).send("No user found with that MayhemId");
        return;
      }

      if (!row.LandSavePath) {
        res.status(500).send("Land not found");
        return;
      }

      res.download(row.LandSavePath, (err) => {
        if (err) {
          logger.error(err, "Download error");
          res.status(500).send("Error sending file");
        }
      });
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/savefiles/delete", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {

      const mayhemId = req.query.mayhemId ? req.query.mayhemId : "No MayhemId";

      const USERINFO_BY_MAYHEMID_QUERY = "SELECT LandSavePath from UserData WHERE MayhemId = ?;";
      const row = await dbGet(USERINFO_BY_MAYHEMID_QUERY, [mayhemId]);
      
      if (!row) {
        res.status(400).send("No user found with that MayhemId");
        return;
      }

      if (!row.LandSavePath || !fs.existsSync(config.dataDirectory + "/" + mayhemId)) {
        res.status(500).send("Land not found");
        return;
      }

      if (fs.existsSync(config.dataDirectory + "/" + mayhemId))
        fs.rmSync(config.dataDirectory + "/" + mayhemId, { recursive: true, force: true });

      res.status(200).send("Deleted town");
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

// -- Logs -- \\

router.get("/logs", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const lines = req.query.lines ? Number(req.query.lines) : 500;
      try {
        const LOG_PATH = path.resolve(process.cwd(), "latest.log");
        try {
          await fsp.access(LOG_PATH);
        } catch (e) {
          return res.json({ data: [] });
        }
        const raw = await fsp.readFile(LOG_PATH, "utf8");
        const all = raw.split("\n").filter((l) => l.length > 0);
        const out = all.slice(Math.max(0, all.length - lines));
        res.json({ data: out });
      } catch (err) {
        logger.error(err, "Error reading latest.log");
        res.status(500).send("Could not read logs");
      }
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.get("/logs/stream", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (!(key && key === config.adminKey)) {
      return res.status(401).send("Invalid or Empty Key");
    }

    const logPath = path.resolve(process.cwd(), "latest.log");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    try { if (res.flushHeaders) res.flushHeaders(); } catch (err) { logger.error(err, "[SSE_FLUSH_HEADERS_ERROR]"); }
    res.write(`retry: 2000\n\n`);

    let lastSize = 0;
    try {
      try {
        await fsp.access(logPath);
        const st = await fsp.stat(logPath);
        lastSize = st.size;
        // send last small portion
        const raw = await fsp.readFile(logPath, "utf8");
        const lines = raw.split("\n").filter((l) => l.length > 0);
        const out = lines.slice(Math.max(0, lines.length - 200));
        try {
          res.write(`data: ${JSON.stringify(out.join('\n'))}\n\n`);
          if (res.flush) try { res.flush(); } catch (err) { logger.error(err, "[SSE_FLUSH_ERROR]"); }
        } catch (err) { logger.error(err, "[SSE_WRITE_ERROR]"); }
      } catch (e) {
        logger.error(e, "[SSE_FILE_READ_ERROR]");
      }
    } catch (err) {
      logger.error(err, "Error initializing log stream");
    }

    const watcher = fs.watch(logPath, { persistent: true }, (eventType) => {
      try {
        if (eventType !== "change" && eventType !== "rename") return;
        (async () => {
          try {
            try {
              await fsp.access(logPath);
            } catch (e) {
              // file removed/rotated briefly; treat as truncation and send empty payload
              lastSize = 0;
              try {
                const raw = await fsp.readFile(logPath, "utf8");
                const lines = raw.split("\n").filter((l) => l.length > 0);
                res.write(`data: ${JSON.stringify(lines.join('\n'))}\n\n`);
              } catch (err) {
                // ignore read errors here
              }
              return;
            }

            const st = await fsp.stat(logPath);
            if (st.size > lastSize) {
              const stream = fs.createReadStream(logPath, { start: lastSize, end: st.size });
              let chunk = "";
              stream.on("data", (c) => (chunk += c.toString()));
              stream.on("end", () => {
                lastSize = st.size;
                const newLines = chunk.split("\n").filter((l) => l.length > 0);
                if (newLines.length > 0) {
                  try {
                    res.write(`data: ${JSON.stringify(newLines.join('\n'))}\n\n`);
                    if (res.flush) try { res.flush(); } catch (err) { logger.error(err, "[SSE_FLUSH_ERROR]"); }
                  } catch (err) { logger.error(err, "[SSE_WRITE_CHUNK_ERROR]"); }
                }
              });
            } else if (st.size < lastSize) {
              // File was truncated or rotated. Send the whole file to the client so UI can refresh.
              try {
                const raw = await fsp.readFile(logPath, "utf8");
                const lines = raw.split("\n").filter((l) => l.length > 0);
                try {
                  res.write(`data: ${JSON.stringify(lines.join('\n'))}\n\n`);
                  if (res.flush) try { res.flush(); } catch (err) { logger.error(err, "[SSE_FLUSH_ERROR]"); }
                } catch (err) { logger.error(err, "[SSE_WRITE_TRUNCATED_ERROR]"); }
                lastSize = st.size;
              } catch (err) {
                logger.error(err, "Error reading log after truncation");
              }
            }
          } catch (err) {
            logger.error(err, "Error streaming logs (async)");
          }
        })();
      } catch (err) {
        logger.error(err, "Error streaming logs");
      }
    });

    req.on("close", () => {
      try {
        watcher.close();
      } catch (err) {
        // ignore
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logs/clear", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (!(key && key === config.adminKey)) {
      return res.status(401).send("Invalid or Empty Key");
    }

    const logPath = path.resolve(process.cwd(), "latest.log");
    try {
      // Truncate the log file safely
      try {
        await fsp.access(logPath);
        const handle = await fsp.open(logPath, 'r+');
        try {
          await handle.truncate(0);
        } finally {
          await handle.close();
        }
      } catch (e) {
        // ensure file exists
        await fsp.writeFile(logPath, '', { encoding: 'utf8' });
      }

      // Write a small audit entry so the file is not empty
      const now = new Date().toLocaleTimeString("nb-NO", { hour12: false });
      await fsp.appendFile(logPath, `[${now}] Logs cleared by admin\n`);

      // Try to clear the server console (if attached) by writing ANSI clear sequence to stdout
      let stdoutIsTTY = !!process.stdout?.isTTY;
      try {
        if (stdoutIsTTY) process.stdout.write('\x1b[2J\x1b[0;0H');
      } catch (err) {
        // ignore
        stdoutIsTTY = false;
      }

      // Read back the (now small) file contents to return to client so UI can update immediately
      let lines = [];
      try {
        const raw = await fsp.readFile(logPath, 'utf8');
        lines = raw.split('\n').filter((l) => l.length > 0);
      } catch (err) {
        logger.error(err, "Error reading log after clear:");
      }

      res.json({ message: 'Cleared logs', stdoutIsTTY, data: lines, cleared: true });
    } catch (err) {
      logger.error(err, "Error clearing logs");
      res.status(500).send("Could not clear logs");
    }
  } catch (error) {
    next(error);
  }
});

// -- Config -- \\

router.get("/config/get", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      try {
        const raw = await fsp.readFile("./config.json", "utf8");
        const cfg = JSON.parse(raw);
        res.json(cfg);
      } catch (err) {
        logger.error(err, "Error reading config.json");
        res.status(500).send("Could not read config");
      }
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/config/update", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const updates = req.body || {};
      const cfgPath = "./config.json";

      try {
        const raw = await fsp.readFile(cfgPath, "utf8");
        const cfg = JSON.parse(raw);

        // Only update keys that already exist in the config file
        Object.keys(updates).forEach((k) => {
          if (Object.prototype.hasOwnProperty.call(cfg, k)) {
            cfg[k] = updates[k];
          }
        });

        await fsp.writeFile(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
        res.status(200).send("Updated config");
      } catch (err) {
        logger.error(err, "Error updating config.json");
        res.status(500).send("Could not update config");
      }
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/config/restart", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      // Try to spawn a detached child process to restart the server with the same node executable and args
      try {
        const { spawn } = await import("child_process");

        const nodeExe = process.argv[0];
        const args = process.argv.slice(1); // usually the script path and any args

        const child = spawn(nodeExe, args, {
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        // Give the child a moment to start, then exit current process
        const restartDelayMs = 3000; // wait 3 seconds before exiting to give child time to start
        res.status(200).send("Restarting server");
        setTimeout(() => {
          process.exit(0);
        }, restartDelayMs);
      } catch (err) {
        logger.error(err, "Failed to restart server");
        res.status(500).send("Failed to restart server: " + String(err));
      }
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

// -- Friends System -- \\

// Debug endpoint: List all users (for troubleshooting)
router.get("/friends/debug/all-users", async (req, res, next) => {
  try {
    const token = req.cookies.userAccessToken || req.headers["authorization"]?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const allUsers = await new Promise((resolve, reject) => {
      db.all(
        "SELECT MayhemId, UserId, UserName FROM UserData LIMIT 100",
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    logger.debug({ userCount: allUsers.length }, "Debug: Listing all users");
    res.json({ users: allUsers, count: allUsers.length });
  } catch (error) {
    logger.error(error, "Error getting debug user list");
    res.status(500).json({ error: error.message });
  }
});

router.post("/friends/search", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;
    const { username } = req.body;

    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!username || username.trim().length === 0) {
      return res.status(400).json({ error: "Username is required" });
    }

    // Get current user
    const currentUser = await new Promise((resolve, reject) => {
      db.get("SELECT MayhemId, UserId, UserName FROM UserData WHERE UserAccessToken = ?", [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!currentUser) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Search for user by username (case-insensitive partial match)
    logger.debug({ searchUsername: username, currentUserId: currentUser.UserId }, "Searching for user");
    
    const searchUser = await new Promise((resolve, reject) => {
      db.get(
        "SELECT MayhemId, UserId, UserName FROM UserData WHERE LOWER(UserName) LIKE LOWER(?) AND MayhemId != ? LIMIT 1",
        [`%${username}%`, currentUser.MayhemId],
        (err, row) => {
          if (err) {
            logger.error({ err, searchUsername: username }, "Database error during user search");
            reject(err);
          } else {
            logger.debug({ found: !!row, username: row?.UserName }, "User search result");
            resolve(row);
          }
        }
      );
    });

    if (!searchUser) {
      logger.warn({ searchUsername: username }, "User not found in database");
      return res.json({ found: false, message: "User not found" });
    }

    // Check if already friends or has pending request
    const existing = await new Promise((resolve, reject) => {
      db.get(
        "SELECT status FROM Friends WHERE (ownerMayhemId = ? AND friendMayhemId = ?) OR (ownerMayhemId = ? AND friendMayhemId = ?)",
        [currentUser.MayhemId, searchUser.MayhemId, searchUser.MayhemId, currentUser.MayhemId],
        (err, row) => {
          if (err) {
            logger.warn({ error: err.message }, "Friends table query failed, assuming no relationship");
            resolve(null); // No existing relationship if query fails
          } else {
            resolve(row);
          }
        }
      );
    });

    const status = existing ? existing.status : "none";

    res.json({
      found: true,
      user: {
        mayhemId: searchUser.MayhemId,
        userId: searchUser.UserId,
        username: searchUser.UserName,
      },
      relationshipStatus: status, // "none", "pending", "accepted"
    });
  } catch (error) {
    logger.error(error, "Error searching for user");
    res.json({ found: false, message: "Error searching for user" }); // Graceful error response
  }
});

router.post("/friends/send-request", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;
    const { targetMayhemId } = req.body;

    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!targetMayhemId) {
      return res.status(400).json({ error: "Target user ID is required" });
    }

    // Get current user
    const currentUser = await new Promise((resolve, reject) => {
      db.get("SELECT MayhemId FROM UserData WHERE UserAccessToken = ?", [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!currentUser) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Check if already friends or has pending request
    const existing = await new Promise((resolve, reject) => {
      db.get(
        "SELECT status FROM Friends WHERE (ownerMayhemId = ? AND friendMayhemId = ?) OR (ownerMayhemId = ? AND friendMayhemId = ?)",
        [currentUser.MayhemId, targetMayhemId, targetMayhemId, currentUser.MayhemId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (existing) {
      return res.json({ success: false, message: `Already ${existing.status}` });
    }

    // Create new friend request
    const now = Math.floor(Date.now() / 1000);
    await new Promise((resolve, reject) => {
      db.run(
        "INSERT INTO Friends (ownerMayhemId, friendMayhemId, status, createdAt) VALUES (?, ?, ?, ?)",
        [currentUser.MayhemId, targetMayhemId, "pending", now],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ success: true, message: "Friend request sent" });
  } catch (error) {
    logger.error(error, "Error sending friend request");
    res.status(500).json({ error: error.message });
  }
});

router.post("/friends/accept-request", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;
    const { fromMayhemId } = req.body;

    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!fromMayhemId) {
      return res.status(400).json({ error: "From user ID is required" });
    }

    logger.info({ fromMayhemId }, "Friend request acceptance initiated");

    // Get current user
    const currentUser = await new Promise((resolve, reject) => {
      db.get("SELECT MayhemId, UserName FROM UserData WHERE UserAccessToken = ?", [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!currentUser) {
      return res.status(401).json({ error: "Invalid token" });
    }

    logger.info({ fromMayhemId, toMayhemId: currentUser.MayhemId, toUserName: currentUser.UserName }, "Accepting friendship from user");

    // Update the original friendship to accepted
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE Friends SET status = ? WHERE ownerMayhemId = ? AND friendMayhemId = ? AND status = ?",
        ["accepted", fromMayhemId, currentUser.MayhemId, "pending"],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    logger.info({ fromMayhemId, toMayhemId: currentUser.MayhemId }, "Primary friendship updated to accepted");

    // Create reciprocal friendship
    const now = Math.floor(Date.now() / 1000);
    await new Promise((resolve, reject) => {
      db.run(
        "INSERT OR IGNORE INTO Friends (ownerMayhemId, friendMayhemId, status, createdAt) VALUES (?, ?, ?, ?)",
        [currentUser.MayhemId, fromMayhemId, "accepted", now],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    logger.info({ fromMayhemId, toMayhemId: currentUser.MayhemId }, "Reciprocal friendship created");

    res.json({ success: true, message: "Friend request accepted" });
  } catch (error) {
    logger.error(error, "Error accepting friend request");
    res.status(500).json({ error: error.message });
  }
});

router.post("/friends/reject-request", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;
    const { fromMayhemId } = req.body;

    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!fromMayhemId) {
      return res.status(400).json({ error: "From user ID is required" });
    }

    // Get current user
    const currentUser = await new Promise((resolve, reject) => {
      db.get("SELECT MayhemId FROM UserData WHERE UserAccessToken = ?", [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!currentUser) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Delete the friendship request
    await new Promise((resolve, reject) => {
      db.run(
        "DELETE FROM Friends WHERE ownerMayhemId = ? AND friendMayhemId = ? AND status = ?",
        [fromMayhemId, currentUser.MayhemId, "pending"],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ success: true, message: "Friend request rejected" });
  } catch (error) {
    logger.error(error, "Error rejecting friend request");
    res.status(500).json({ error: error.message });
  }
});

router.get("/friends/list", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;

    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Get current user
    const currentUser = await new Promise((resolve, reject) => {
      db.get("SELECT MayhemId FROM UserData WHERE UserAccessToken = ?", [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!currentUser) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Get all accepted friends with their LastPlayedTime from database
    const friends = await new Promise((resolve, reject) => {
      db.all(
        `SELECT u.MayhemId, u.UserId, u.UserName, u.LastPlayedTime FROM UserData u
         WHERE u.MayhemId IN (
           SELECT friendMayhemId FROM Friends WHERE ownerMayhemId = ? AND status = ?
         )`,
        [currentUser.MayhemId, "accepted"],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    res.json({
      success: true,
      friends: friends.map(f => {
        const session = sessionManager.getSession(f.UserId?.toString());
        // Use session's lastActive if user is currently online, otherwise use database LastPlayedTime
        // LastPlayedTime is stored as milliseconds in the database
        const lastActive = session?.lastActive || f.LastPlayedTime || null;
        return {
          mayhemId: f.MayhemId,
          userId: f.UserId,
          username: f.UserName,
          lastActive: lastActive,
          isOnline: session ? true : false,
        };
      }),
    });
  } catch (error) {
    logger.error(error, "Error getting friends list");
    res.status(500).json({ error: error.message });
  }
});

router.get("/friends/pending-sent", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;

    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Get current user
    const currentUser = await new Promise((resolve, reject) => {
      db.get("SELECT MayhemId FROM UserData WHERE UserAccessToken = ?", [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!currentUser) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Get all pending friend requests sent by this user
    const pending = await new Promise((resolve, reject) => {
      db.all(
        `SELECT u.MayhemId, u.UserId, u.UserName FROM UserData u
         WHERE u.MayhemId IN (
           SELECT friendMayhemId FROM Friends WHERE ownerMayhemId = ? AND status = ?
         )`,
        [currentUser.MayhemId, "pending"],
        (err, rows) => {
          if (err) {
            logger.warn({ error: err.message }, "Friends table query failed, returning empty list");
            resolve([]); // Return empty list if Friends table query fails
          } else {
            resolve(rows || []);
          }
        }
      );
    });

    res.json({
      success: true,
      pending: pending.map(p => ({
        mayhemId: p.MayhemId,
        userId: p.UserId,
        username: p.UserName,
      })),
    });
  } catch (error) {
    logger.error(error, "Error getting pending sent requests");
    res.json({ success: true, pending: [] }); // Return empty list instead of error
  }
});

router.get("/friends/pending-received", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;

    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Get current user
    const currentUser = await new Promise((resolve, reject) => {
      db.get("SELECT MayhemId FROM UserData WHERE UserAccessToken = ?", [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!currentUser) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Get all pending friend requests received by this user
    const pending = await new Promise((resolve, reject) => {
      db.all(
        `SELECT u.MayhemId, u.UserId, u.UserName FROM UserData u
         WHERE u.MayhemId IN (
           SELECT ownerMayhemId FROM Friends WHERE friendMayhemId = ? AND status = ?
         )`,
        [currentUser.MayhemId, "pending"],
        (err, rows) => {
          if (err) {
            logger.warn({ error: err.message }, "Friends table query failed, returning empty list");
            resolve([]); // Return empty list if Friends table query fails
          } else {
            resolve(rows || []);
          }
        }
      );
    });

    res.json({
      success: true,
      pending: pending.map(p => ({
        mayhemId: p.MayhemId,
        userId: p.UserId,
        username: p.UserName,
      })),
    });
  } catch (error) {
    logger.error(error, "Error getting pending received requests");
    res.json({ success: true, pending: [] }); // Return empty list instead of error
  }
});

router.post("/friends/remove", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;
    const { friendMayhemId } = req.body;

    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!friendMayhemId) {
      return res.status(400).json({ error: "Friend ID is required" });
    }

    // Get current user
    const currentUser = await new Promise((resolve, reject) => {
      db.get("SELECT MayhemId FROM UserData WHERE UserAccessToken = ?", [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!currentUser) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Delete the friendship (both directions)
    await new Promise((resolve, reject) => {
      db.run(
        "DELETE FROM Friends WHERE (ownerMayhemId = ? AND friendMayhemId = ?) OR (ownerMayhemId = ? AND friendMayhemId = ?)",
        [currentUser.MayhemId, friendMayhemId, friendMayhemId, currentUser.MayhemId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ success: true, message: "Friend removed" });
  } catch (error) {
    logger.error(error, "Error removing friend");
    res.status(500).json({ error: error.message });
  }
});

// -- Backups -- \\

router.get("/backups/list", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const stats = await backupManager.getBackupStats();
      res.json(stats);
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    logger.error(error, "Error listing backups");
    res.status(500).json({ error: error.message });
  }
});

router.post("/backups/create", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const reason = req.body.reason || "manual";
      const backup = await backupManager.createBackup(reason);

      if (backup) {
        res.json({
          success: true,
          message: "Backup created successfully",
          backup,
        });
      } else {
        res.status(500).json({ error: "Failed to create backup" });
      }
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    logger.error(error, "Error creating backup");
    res.status(500).json({ error: error.message });
  }
});

router.post("/backups/delete", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const { backupName } = req.body;

      if (!backupName) {
        return res.status(400).json({ error: "Backup name required" });
      }

      const success = await backupManager.deleteBackup(backupName);

      if (success) {
        res.json({
          success: true,
          message: `Backup ${backupName} deleted`,
        });
      } else {
        res.status(500).json({ error: "Failed to delete backup" });
      }
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    logger.error(error, "Error deleting backup");
    res.status(500).json({ error: error.message });
  }
});

router.post("/backups/restore", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const { backupName } = req.body;

      if (!backupName) {
        return res.status(400).json({ error: "Backup name required" });
      }

      // If database is paused, try to forcefully close it to release file locks
      try {
        const { isDatabasePaused } = await import("../../../lib/db.js");
        if (isDatabasePaused()) {
          // Force close the database connection if paused
          db.close((err) => {
            if (err) {
              logger.warn({ error: err.message }, "Could not close database for restore");
            } else {
              logger.info("Database closed for restore");
            }
          });
          // Give it a moment to close
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (dbErr) {
        logger.warn({ error: dbErr.message }, "Could not check/close database");
      }

      const result = await backupManager.restoreBackup(backupName);

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
        });
      } else if (result.requiresServerStop) {
        // 503 Service Unavailable - server needs to be stopped
        res.status(503).json({
          success: false,
          error: result.message,
          requiresServerStop: true,
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.message,
        });
      }
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    logger.error(error, "Error restoring backup");
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

export default router;
