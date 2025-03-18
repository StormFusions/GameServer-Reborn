import { Router, json } from "express";

import sqlite3 from "sqlite3";

import config from "../../../config.json" with { type: "json" };

import generateToken from "../authRoutes/connect/tokenGen.js";

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

router.get("/", async (req, res, next) => {
  try {
    res.render("user-dashboard/signup")
  } catch (error) {
    next(error);
  }
});

router.post("/signup", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).send("Missing field: email");
      return;
    }

    const LAST_USER_QUERY =
          "SELECT MayhemId, UserId from UserData ORDER BY UserId DESC LIMIT 1;";
    await db.get(LAST_USER_QUERY, async (error, row) => {
      // Get the last created user, so we can make the new users ids +1
      if (error) {
        console.error("Error executing query:", error.message);
        res.status(500).send("Internal error");
        return;
      }

      const newUID = row
        ? Number(row.UserId) + 1
        : config.startingUID + 1; /* If there are no users */
      const newMID = row
        ? Number(row.MayhemId) + 1
        : config.startingMID + 1; /* If there are no users */

      const newAccessToken = generateToken("AT", newUID.toString());
      const newAccessCode = generateToken("AC", newUID.toString());

      const NEW_USER_QUERY = `INSERT INTO UserData (UserId, MayhemId, UserEmail, UserName, UserAccessToken, UserAccessCode) VALUES (?, ?, ?, ?, ?, ?)`;
      await db.get(NEW_USER_QUERY, [newUID, newMID, email, email.split("@")[0], newAccessToken, newAccessCode], async (error, row) => {
        if (error) {
          if (error.message.includes('SQLITE_CONSTRAINT: UNIQUE constraint failed: UserData.UserEmail')) {
            res.status(400).send("Email already in use");
          } else {
            console.error("Error executing query:", error.message);
            res.status(500).send("Internal Error");
          }

          return;
        }

        res.status(200).send("User created successfully");
      });
    });

  } catch (error) {
    next(error);
  }
});

export default router;
