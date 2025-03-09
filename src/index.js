import express from "express";
import routes from "./routes/routes.js";

import compression from "compression";

import { debugWithTime } from "./util/debugUtil.js";

import "dotenv/config";
import config from "../config.json" with { type: "json" };
const configFilePath = "./config.json";

import fs from "fs";
import sqlite3 from "sqlite3";

import { randomBytes } from "crypto";

const db = new sqlite3.Database(
  config.dataDirectory + "/users.db",
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, // Make the database file if it doesn't already exist
  (error) => {
    if (error) {
      console.error("[index.js] Error opening database:", error.message);
    }
  },
);

// Make a key for the admin dashboard if it doesn't already exist
if (!config.adminKey) config.adminKey = randomBytes(32).toString("hex"); // Random key that looks similar to a SHA256 hash
await fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2)); // Update the file too, since "config.adminKey = " just changes it in memory

const app = express();
const PORT = process.env.LISTEN_PORT || config.listenPort;

app.set("view engine", "pug");
app.set("views", "./src/views");

const QUERY =
  "CREATE TABLE IF NOT EXISTS UserData (MayhemId int unique, UserId int unique, UserAccessToken string, UserAccessCode string, UserRefreshToken string, SessionId string unique, SessionKey string unique, WholeLandToken string, LandSavePath string, CurrencySavePath string);";
await db.run(QUERY, async (error) => {
  // Make sure database is initialized
  if (error) {
    console.error("Could not initialize database: ", error.message);
    return;
  }
});

db.close((error) => {
  if (error) {
    console.error("Error closing database:", error.message);
    return;
  }
});

app.use((req, res, next) => {
  debugWithTime(`${req.method} ${req.originalUrl}`);
  next();
});

app.use(
  compression({
    filter: (req, res) => {
      return true; // Always compress the response
    },
    threshold: 0,
  }),
);

app.use(routes);

if (config.serveDlcsLocally) {
  debugWithTime("Serving DLCs from local directory: " + config.localDlcFolder);

  if (!fs.existsSync(config.localDlcFolder)) {
    fs.mkdirSync(config.localDlcFolder);
  }

  app.use("/dlc", express.static(config.localDlcFolder));
} else {
  debugWithTime("DLCs will not be served from a local directory.");
}

app.get("/", (req, res) => {
  res.send("Hello, World!");
});

app.use((req, res) => {
  res.status(404).send("Do'h! Error 404");
});

app.listen(PORT, () => {
  debugWithTime(`Listening on port ${PORT}`);
  global.running = true; // For the dashboard
  global.lobbyTime = 0; // 0 for current time
});
