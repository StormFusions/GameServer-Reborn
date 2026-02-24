import { Router } from "express";

import db, { dbGet, dbRun } from "../../../lib/db.js";
import { randomBytes } from "crypto";

import config from "../../../../config.json" with { type: "json" };

import jwt from "jsonwebtoken";
import generateToken from "./tokenGen.js";
import { logger } from "../../../lib/logger.js";
import fsp from "fs/promises";
import fs from "fs";
import path from "path";

const router = Router();

// Helper: Get next user ID and Mayhem ID
const getNextUserId = async () => {
  const LAST_USER_QUERY = "SELECT MayhemId, UserId FROM UserData ORDER BY UserId DESC LIMIT 1;";
  const row = await dbGet(LAST_USER_QUERY, []);
  return {
    newUID: row ? Number(row.UserId) + 1 : config.startingUID + 1,
    newMID: row ? (BigInt(row.MayhemId) + 1n).toString() : (BigInt(config.startingMID) + 1n).toString(),
  };
};

// Helper: Extract advertisingId from sig header
const extractAdvertisingId = (sig) => {
  if (!sig) return null;
  try {
    const header = sig.split(".")[0].trim();
    const decodedHeader = Buffer.from(header, "base64").toString("utf8");
    const parsed = JSON.parse(decodedHeader);
    return parsed.advertisingId || null;
  } catch (error) {
    logger.warn({ err: error, sig }, "Could not extract advertisingId from sig");
    return null;
  }
};

// Helper: Initialize new player's land and currency files
const initializePlayerData = async (newMID, newUID) => {
  try {
    const dataDir = path.join(config.dataDirectory, newMID);
    const landSavePath = path.posix.join(config.dataDirectory, newMID, `${newMID}.land`);
    const currencySavePath = path.posix.join(config.dataDirectory, newMID, `${newMID}.currency`);

    // Create directory if it doesn't exist
    await fsp.mkdir(dataDir, { recursive: true });

    // Try to find an existing land file to use as template
    const templateDir = path.join(config.dataDirectory);
    const dirs = await fsp.readdir(templateDir);
    let templateLandPath = null;

    for (const dir of dirs) {
      const fullPath = path.join(templateDir, dir);
      const stats = await fsp.stat(fullPath);
      if (stats.isDirectory()) {
        const landFile = path.join(fullPath, `${dir}.land`);
        try {
          await fsp.stat(landFile);
          templateLandPath = landFile;
          break;
        } catch (e) {
          // This directory doesn't have a land file, try next
        }
      }
    }

    // Copy template land file or create minimal one
    if (templateLandPath) {
      await fsp.copyFile(templateLandPath, landSavePath);
      logger.info({ newMID, templateLandPath }, "Initialized land file from template");
    } else {
      logger.warn({ newMID }, "No template land file found, creating empty placeholder");
      await fsp.writeFile(landSavePath, Buffer.alloc(0));
    }

    // Initialize currency file with empty buffer (will be created on first access)
    await fsp.writeFile(currencySavePath, Buffer.alloc(0));
    logger.info({ newMID, landSavePath, currencySavePath }, "Initialized player data files");

    return { landSavePath, currencySavePath };
  } catch (error) {
    logger.error({ err: error, newMID }, "Error initializing player data");
    return null;
  }
};

router.get("/auth", async (req, res, next) => {
  try {
    logger.info({ query: req.query }, "Auth endpoint called");
    if (req.query.email) {
      // Generate new email account
      const responseType = req.query.response_type.split(" ");
      const { newUID, newMID } = await getNextUserId();

      const newAccessToken = generateToken("AT", newUID.toString());
      const newAccessCode = generateToken("AC", newUID.toString());

      // Initialize player data files
      const playerData = await initializePlayerData(newMID, newUID);
      const landSavePath = playerData ? playerData.landSavePath : null;
      const currencySavePath = playerData ? playerData.currencySavePath : null;

      const NEW_USER_QUERY = `INSERT INTO UserData (UserId, MayhemId, UserEmail, UserName, UserAccessToken, UserAccessCode, LandSavePath, CurrencySavePath) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
      await dbRun(NEW_USER_QUERY, [newUID, newMID, req.query.email, `${req.query.email.toLowerCase().split("@")[0]}_${randomBytes(2).toString("hex").slice(0, 4)}`, newAccessToken, newAccessCode, landSavePath, currencySavePath]);

      const response = {};
      if (responseType.includes("code")) response.code = newAccessCode;
      if (responseType.includes("lnglv_token")) response.lnglv_token = newAccessToken;

      res.status(200).send(response);

    } else {
      const responseType = req.query.response_type.split(" ");

      if (req.query.authenticator_login_type === "mobile_anonymous") {
        // Anonymous account - check if device (advertisingId) already has an account
        let advertisingId = extractAdvertisingId(req.query.sig);
        
        // Also check for device ID in other common locations
        if (!advertisingId) {
          advertisingId = req.query.device_id || req.headers["x-device-id"] || req.headers["device-id"];
        }

        // Check if this device already has an account
        if (advertisingId) {
          const EXISTING_DEVICE_QUERY = "SELECT UserId, UserAccessToken, UserAccessCode FROM UserData WHERE AdvertisingId = ? LIMIT 1;";
          const existingUser = await dbGet(EXISTING_DEVICE_QUERY, [advertisingId]);
          
          if (existingUser) {
            logger.info({ advertisingId, userId: existingUser.UserId }, "Device recognized - returning existing account");
            const response = {};
            if (responseType.includes("code")) response.code = existingUser.UserAccessCode;
            if (responseType.includes("lnglv_token")) response.lnglv_token = existingUser.UserAccessToken;
            res.status(200).send(response);
            return;
          }
        }

        // Device not found or no advertisingId - create new account
        const { newUID, newMID } = await getNextUserId();
        const newAccessToken = generateToken("AT", newUID.toString());
        const newAccessCode = generateToken("AC", newUID.toString());

        // Initialize player data files
        const playerData = await initializePlayerData(newMID, newUID);
        const landSavePath = playerData ? playerData.landSavePath : null;
        const currencySavePath = playerData ? playerData.currencySavePath : null;

        const NEW_USER_QUERY = `INSERT INTO UserData (UserId, MayhemId, UserAccessToken, UserAccessCode, AdvertisingId, LandSavePath, CurrencySavePath) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        await dbRun(NEW_USER_QUERY, [newUID, newMID, newAccessToken, newAccessCode, advertisingId, landSavePath, currencySavePath]);
        logger.info({ userId: newUID, advertisingId }, "New anonymous account created");

        const response = {};
        if (responseType.includes("code")) response.code = newAccessCode;
        if (responseType.includes("lnglv_token")) response.lnglv_token = newAccessToken;

        res.status(200).send(response);

      } else if (req.query.authenticator_login_type === "mobile_ea_account") {
        // Email login
        const sig = req.query.sig;
        if (!sig) {
          res.status(400).send({ message: "Missing field: sig" });
          return;
        }

        let email, cred, advertisingId;
        try {
          const header = sig.split(".")[0].trim();
          const decodedHeader = Buffer.from(header, "base64").toString("utf8");
          const parsed = JSON.parse(decodedHeader);
          email = parsed.email;
          cred = parsed.cred;
          advertisingId = parsed.advertisingId;
          logger.info({ email, advertisingId }, "Extracted email and advertisingId from EA account auth");
        } catch (error) {
          res.status(400).send({ message: "Invalid sig" });
          logger.error({ err: error }, "Invalid sig format");
          return;
        }

        const USER_BY_EMAIL = "SELECT UserId, MayhemId, UserAccessToken, UserAccessCode, UserCred, AdvertisingId FROM UserData WHERE UserEmail = ?;";
        const row = await dbGet(USER_BY_EMAIL, [email]);

        if (!row) {
          res.status(404).send({ message: "No users found with that email" });
          return;
        }

        if (row.UserCred !== cred && config.useSMTP) {
          res.status(400).send({ message: "Invalid code" });
          return;
        }

        // Update advertisingId if it's new (device changed or first login)
        if (advertisingId && row.AdvertisingId !== advertisingId) {
          const UPDATE_DEVICE_ID = "UPDATE UserData SET AdvertisingId = ? WHERE UserEmail = ?;";
          await dbRun(UPDATE_DEVICE_ID, [advertisingId, email]);
          logger.info({ email, newAdvertisingId: advertisingId, oldAdvertisingId: row.AdvertisingId }, "Updated device ID for email account");
        }

        const response = {};
        if (responseType.includes("code")) response.code = row.UserAccessCode;
        if (responseType.includes("lnglv_token")) response.lnglv_token = row.UserAccessToken;

        res.status(200).send(response);
      } else {
        res.status(400).send({ message: "Unknown authenticator_login_type" });
        return;
      }
    }
  } catch (error) {
    logger.error({ err: error }, "Error in /auth");
    next(error);
  }
});

router.post("/token", async (req, res, next) => {
  try {
    if (req.query.grant_type === "authorization_code" || req.query.grant_type === "add_authenticator") {
      const code = req.query.code;
      const USER_BY_CODE_QUERY = "SELECT UserId, UserAccessToken, UserEmail FROM UserData WHERE UserAccessCode = ?;";
      
      const row = await dbGet(USER_BY_CODE_QUERY, [code]);
      if (!row) {
        res.status(400).send({ message: "No user could be found with that UserAccessCode" });
        return;
      }

      res.status(200).send({
        access_token: row.UserAccessToken,
        expires_in: 368435455,
        id_token: jwt.sign(
          {
            aud: "simpsons4-android-client",
            iss: "accounts.ea.com",
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 368435455,
            pid_id: row.UserId.toString(),
            user_id: row.UserId.toString(),
            persona_id: row.UserId,
            pid_type: row.UserEmail ? "NUCLEUS" : "AUTHENTICATOR_ANONYMOUS",
            auth_time: 0,
          },
          "2Tok8RykmQD41uWDv5mI7JTZ7NIhcZAIPtiBm4Z5"
        ),
        refresh_token: "NotImplemented",
        refresh_token_expires_in: 368435455,
        token_type: "Bearer",
      });

    } else if (req.query.grant_type === "remove_authenticator") {
      const { newUID, newMID } = await getNextUserId();
      const newAccessToken = generateToken("AT", newUID.toString());
      const newAccessCode = generateToken("AC", newUID.toString());

      // Initialize player data files
      const playerData = await initializePlayerData(newMID, newUID);
      const landSavePath = playerData ? playerData.landSavePath : null;
      const currencySavePath = playerData ? playerData.currencySavePath : null;

      const NEW_USER_QUERY = `INSERT INTO UserData (UserId, MayhemId, UserAccessToken, UserAccessCode, LandSavePath, CurrencySavePath) VALUES (?, ?, ?, ?, ?, ?)`;
      await dbRun(NEW_USER_QUERY, [newUID, newMID, newAccessToken, newAccessCode, landSavePath, currencySavePath]);
      res.status(200).send({
        access_token: newAccessToken,
        expires_in: 368435455,
        id_token: jwt.sign(
          {
            aud: "simpsons4-android-client",
            iss: "accounts.ea.com",
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 368435455,
            pid_id: newUID.toString(),
            user_id: newUID.toString(),
            persona_id: newUID,
            pid_type: "AUTHENTICATOR_ANONYMOUS",
            auth_time: 0,
          },
          "2Tok8RykmQD41uWDv5mI7JTZ7NIhcZAIPtiBm4Z5"
        ),
        refresh_token: "NotImplemented",
        refresh_token_expires_in: 368435455,
        token_type: "Bearer",
      });
    }
  } catch (error) {
    logger.error({ err: error }, "Error in /token");
    next(error);
  }
});

router.get("/tokeninfo", async (req, res, next) => {
  try {
    const accessToken = req.headers["access_token"] || req.query.access_token;
    const USER_BY_TOKEN_QUERY = "SELECT UserId, UserEmail FROM UserData WHERE UserAccessToken = ?;";
    
    const row = await dbGet(USER_BY_TOKEN_QUERY, [accessToken]);
    if (!row) {
      res.status(400).send({ message: "No user could be found with that UserAccessToken" });
      return;
    }

    const response = {
      client_id: "long_live_token",
      expires_in: 368435455,
      persona_id: row.UserId,
      pid_id: row.UserId.toString(),
      pid_type: row.UserEmail ? "NUCLEUS" : "AUTHENTICATOR_ANONYMOUS",
      scope: "offline basic.antelope.links.bulk openid signin antelope-rtm-readwrite search.identity basic.antelope basic.identity basic.persona antelope-inbox-readwrite",
      user_id: row.UserId.toString(),
    };

    if (req.headers["x-check-underage"] === "true") {
      response.is_underage = false;
    }
    if (req.headers["x-include-authenticators"] === "true") {
      response.authenticators = row.UserEmail 
        ? [
            { authenticator_pid_id: row.UserId, authenticator_type: "AUTHENTICATOR_ANONYMOUS" },
            { authenticator_pid_id: row.UserId, authenticator_type: "NUCLEUS" },
          ]
        : [{ authenticator_pid_id: row.UserId, authenticator_type: "AUTHENTICATOR_ANONYMOUS" }];
    }
    if (req.headers["x-include-stopprocess"] === "true") {
      response.stopProcess = "OFF";
    }
    if (req.headers["x-include-tid"] === "true") {
      response.telemetry_id = row.UserId;
    }

    res.status(200).send(response);
  } catch (error) {
    logger.error({ err: error }, "Error in /tokeninfo");
    next(error);
  }
});

export default router;
