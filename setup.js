import fs from "fs";
import { randomBytes } from "crypto";
import sqlite3 from "sqlite3";

const CONFIG_PATH = "./config.json";

const DEFAULT_CONFIG = {
  verbose: true,
  ip: "0.0.0.0",
  listenPort: 4242,
  proxyPort: 8080,
  dataDirectory: "data",
  startingDonuts: 0,
  startingUID: 1000000000000,
  startingMID: "3042000000000000",
  adminKey: "",
  useTSTO_API: false,
  TSTO_APIkey: "",
  TSTO_APIteam: "",
  useSMTP: false,
  SMTPhost: "mail.example.com",
  SMTPport: 465,
  SMTPsecure: true,
  SMTPuser: "user",
  SMTPpass: "pass",
  serveDlcsLocally: true,
  localDlcFolder: "/dlc",
  backupDirectory: "backups",
  backupInterval: 21600000,
  maxBackups: 10
};

if (!fs.existsSync(CONFIG_PATH)) {
  DEFAULT_CONFIG.adminKey = randomBytes(32).toString("hex");
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
  console.log("Created default config.json — please review and update it before running the server.");
} else {
  // Merge in any missing keys without overwriting existing values
  const existing = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  let changed = false;
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (!(key in existing)) {
      existing[key] = value;
      changed = true;
    }
  }
  // Generate adminKey if it's missing or empty
  if (!existing.adminKey) {
    existing.adminKey = randomBytes(32).toString("hex");
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2), "utf8");
    console.log("config.json updated with missing default keys.");
  }
}

// --- Database initialization ---
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

// Ensure data directory exists
if (!fs.existsSync(config.dataDirectory)) {
  fs.mkdirSync(config.dataDirectory, { recursive: true });
  console.log(`Created data directory: ${config.dataDirectory}`);
}

const dbPath = `${config.dataDirectory}/users.db`;

await new Promise((resolve, reject) => {
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) return reject(err);

    db.serialize(() => {
      // UserData table
      db.run(`
        CREATE TABLE IF NOT EXISTS UserData (
          MayhemId TEXT UNIQUE,
          UserId INT UNIQUE,
          UserName TEXT UNIQUE,
          UserEmail TEXT UNIQUE,
          UserCred INT,
          UserAccessToken TEXT UNIQUE,
          UserAccessCode TEXT UNIQUE,
          UserRefreshToken TEXT UNIQUE,
          SessionId TEXT UNIQUE,
          SessionKey TEXT UNIQUE,
          WholeLandToken TEXT,
          LandSavePath TEXT,
          CurrencySavePath TEXT,
          AdvertisingId TEXT,
          LastPlayedTime INTEGER
        );
      `, (err) => { if (err) console.error("Could not create UserData table:", err.message); });

      // Add LastPlayedTime column for existing DBs (ignore error if column already exists)
      db.run("ALTER TABLE UserData ADD COLUMN LastPlayedTime INTEGER;", () => {});

      // Initialize LastPlayedTime for existing rows
      db.run("UPDATE UserData SET LastPlayedTime = ? WHERE LastPlayedTime IS NULL;", [Date.now()]);

      // UserData indexes
      db.run("CREATE INDEX IF NOT EXISTS idx_userid ON UserData(UserId);");
      db.run("CREATE INDEX IF NOT EXISTS idx_mayhemid ON UserData(MayhemId);");
      db.run("CREATE INDEX IF NOT EXISTS idx_last_played_time ON UserData(LastPlayedTime);");

      // Friends table
      db.run(`
        CREATE TABLE IF NOT EXISTS Friends (
          ownerMayhemId TEXT,
          friendMayhemId TEXT,
          status TEXT,
          createdAt INTEGER
        );
      `, (err) => { if (err) console.error("Could not create Friends table:", err.message); });

      // Friends indexes
      db.run("CREATE INDEX IF NOT EXISTS idx_friends_owner_status ON Friends(ownerMayhemId, status);");
      db.run("CREATE INDEX IF NOT EXISTS idx_friends_friend_status ON Friends(friendMayhemId, status);");
      db.run("CREATE INDEX IF NOT EXISTS idx_friends_created ON Friends(createdAt);");

      db.run("SELECT 1;", (err) => {
        // Final no-op to flush serialize queue, then close
        db.close((closeErr) => {
          if (closeErr) return reject(closeErr);
          console.log("Database initialized.");
          resolve();
        });
      });
    });
  });
});
