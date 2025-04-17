import { Router, json } from "express";

import fileUpload from "express-fileupload";

import sqlite3 from "sqlite3";

import protobuf from "protobufjs";
import fs from "fs";

import config from "../../../../config.json" with { type: "json" };

const db = new sqlite3.Database(
  config.dataDirectory + "/users.db",
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (error) => {
    if (error) {
      console.error("Error opening database:", error.message);
    }
  },
);

const router = Router();

router.use(json());

// -- General -- \\

router.get("/general/statistics", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      res.json({
        status: global.running ? "Online" : "Offline",
        uptime: process.uptime(),
        connectedUsers: "Soon...",
      });
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
      global.lobbyTime = timestamp;

      res.status(200).send("Changed Event");
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.get("/event/get", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      res.json({
        lobbyTime: global.lobbyTime,
      });
    } else {
      res.status(401).send("Invalid or Empty Key");
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

      const ALL_USERS_QUERY = "SELECT UserName, UserEmail, MayhemId, UserId FROM UserData LIMIT ? OFFSET ?;";
      const FILTERED_QUERY = "SELECT UserName, UserEmail, MayhemId, UserId FROM UserData WHERE UserName LIKE ? OR UserEmail LIKE ? OR MayhemId LIKE ? OR CAST(UserId AS TEXT) LIKE ? LIMIT ? OFFSET ?;";

      let QUERY_TO_USE = ALL_USERS_QUERY;
      if (query !== "") {
        const likeQuery = `%${query}%`;
        QUERY_TO_USE = FILTERED_QUERY;
        params = [likeQuery, likeQuery, likeQuery, likeQuery, pageSize, offset];
      }

      db.all(QUERY_TO_USE, params, (error, row) => {
        if (error) {
            console.error("Error getting users:", error);
            return res.status(500).send("Internal error");
        }

        res.json({
          data: row
        });
      });

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
    console.error(err);
    res.status(500).send("Internal error");
  }
});

router.post("/users/delete", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const { mayhemId } = req.body;

      const USER_BY_MAYHEMID = "SELECT 1 from UserData WHERE MayhemId = ?;";
      await db.get(USER_BY_MAYHEMID, [mayhemId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          res.status(500).send("Internal error");
          return;
        }

        if (!row) {
          res.status(400).send("No user found with that token");
          return;
        }

        const DELETE_USER_BY_MAYHEMID = "DELETE FROM UserData WHERE MayhemId = ?;";
        await db.run(DELETE_USER_BY_MAYHEMID, [mayhemId]);

        if (fs.existsSync(config.dataDirectory + "/" + mayhemId))
          fs.rmSync(config.dataDirectory + "/" + mayhemId, { recursive: true, force: true });

        res.status(200).send("Deleted user");
      });
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (err) {
    console.error(err);
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
      await db.get(USERINFO_BY_MAYHEMID_QUERY, [mayhemId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          res.status(500).send("Internal error");
          return;
        }

        if (!row) {
          res.status(400).send("No user found with that MayhemId");
          return;
        }

        const root = await protobuf.load("TappedOut.proto");
        const CurrencyData = root.lookupType("Data.CurrencyData");

        let savePath = row.CurrencySavePath;
        if (!savePath || savePath == "") {
          savePath = config.dataDirectory + `/${mayhemId}/${mayhemId}.currency`;
          db.run(UPDATE_QUERY, [savePath, mayhemId], async function (error) {
            if (error) {
              console.error("Error updating CurrencySavePath:", error.message);
              res.status(500).send("Internal error");
              return;
            }
          });
        }

        let message = CurrencyData.create({
          id: mayhemId,
          vcTotalPurchased: 0,
          vcTotalAwarded: req.body.donuts,
          vcBalance: req.body.donuts,
          createdAt: 1715911362,
          updatedAt: Date.now(),
        });
        await fs.writeFileSync(
          savePath,
          CurrencyData.encode(message).finish(),
        );

        res.status(200).send("Donuts updated");

      });
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

      db.all(QUERY_TO_USE, params, async (error, rows) => {
        if (error) {
            console.error("Error getting users:", error);
            return res.status(500).send("Internal error");
        }

        const root = await protobuf.load("TappedOut.proto");
        const CurrencyData = root.lookupType("Data.CurrencyData");

        const usersWithDonuts = await Promise.all(rows.map(async (user) => {
          let donutCount = 0;

          if (user.CurrencySavePath) {
            try {
              const donutFile = fs.readFileSync(user.CurrencySavePath);
              const donutData = CurrencyData.decode(donutFile);
              donutCount = donutData.vcBalance;
            } catch (err) {
              console.error("Error reading or parsing protobuf file:", err);
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
      });

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
      await db.get(USERINFO_BY_MAYHEMID_QUERY, [mayhemId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          res.status(500).send("Internal error");
          return;
        }

        if (!row) {
          res.status(400).send("No user found with that MayhemId");
          return;
        }

        let savePath = row.LandSavePath;
        if (!savePath) {
          savePath = `${config.dataDirectory}/${row.MayhemId}/${row.MayhemId}.land`;

          const UPDATE_QUERY = `UPDATE UserData SET LandSavePath = ? WHERE MayhemId = ?`;
          db.run(UPDATE_QUERY, [savePath, row.MayhemId], async function (error) {
            if (error) {
              console.error("Error:", error.message);
              res.status(500).send("Internal error");
              return;
            }
          });
        }

        if (!fs.existsSync(config.dataDirectory + "/" + row.MayhemId))
          fs.mkdirSync(config.dataDirectory + "/" + row.MayhemId);

        const town = req.files.town;
        town.mv(savePath, (err) => {
          if (err) return res.status(500).send(err);

          res.status(200).send("Town uploaded");
        });
      });
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
      await db.get(USERINFO_BY_MAYHEMID_QUERY, [mayhemId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          res.status(500).send("Internal error");
          return;
        }

        if (!row) {
          res.status(400).send("No user found with that MayhemId")
          return;
        }

        if (!row.LandSavePath) {
          res.status(500).send("Land not found");
          return;
        }

        res.download(row.LandSavePath, (err) => {
          if (err) {
            console.error("Download error:", err);
            res.status(500).send("Error sending file");
          }
        });

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
      await db.get(USERINFO_BY_MAYHEMID_QUERY, [mayhemId], async (error, row) => {
        if (error) {
          console.error("Error executing query:", error.message);
          res.status(500).send("Internal error");
          return;
        }

        if (!row) {
          res.status(400).send("No user found with that MayhemId")
          return;
        }

        if (!row.LandSavePath || !fs.existsSync(config.dataDirectory + "/" + row.MayhemId)) {
          res.status(500).send("Land not found");
          return;
        }

        if (fs.existsSync(config.dataDirectory + "/" + row.MayhemId))
          fs.rmSync(config.dataDirectory + "/" + row.MayhemId, { recursive: true, force: true });

        res.status(200).send("Deleted town");

      });
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

export default router;
