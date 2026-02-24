import { Router } from "express";
import fsp from "fs/promises";
import pb from "../../../lib/protobuf.js";
import db, { dbRun } from "../../../lib/db.js";
import { logger } from "../../../lib/logger.js";

const router = Router();

// POST admin/resetTimers - reset friend-related timers for testing
router.post("/admin/resetTimers/:mayhemId", async (req, res, next) => {
  try {
    const mayhemId = req.params.mayhemId;
    const QUERY = `SELECT LandSavePath FROM UserData WHERE MayhemId = ? OR UserId = ?`;

    db.get(QUERY, [mayhemId, mayhemId], async (err, row) => {
      if (err) {
        logger.error(err, "Error querying UserData for resetTimers:");
        res.status(500).send("Internal error");
        return;
      }

      if (!row || !row.LandSavePath) {
        res.status(404).send("No saved land for that user");
        return;
      }

      const savePath = row.LandSavePath;
      try {
        const data = await fsp.readFile(savePath);
        const LandMessage = pb.lookupType("Data.LandMessage");

        let decoded;
        try {
          decoded = LandMessage.decode(data);
        } catch (decodeErr) {
          logger.warn({ mayhemId }, "Failed to decode LandMessage during reset; creating minimal");
          decoded = LandMessage.create({ id: mayhemId });
        }

        // Reset friend-specific daily action timers
        if (Array.isArray(decoded.customFriendActionData)) {
          decoded.customFriendActionData = [];
        }

        if (Array.isArray(decoded.actionLimitData)) {
          decoded.actionLimitData.forEach((a) => {
            if (a && typeof a === "object") {
              if (typeof a.time !== "undefined") a.time = 0;
            }
          });
        }

        if (decoded.friendData && typeof decoded.friendData === "object") {
          if (typeof decoded.friendData.lastPlayedTime !== "undefined") decoded.friendData.lastPlayedTime = 0;
          if (typeof decoded.friendData.lastVisitTime !== "undefined") decoded.friendData.lastVisitTime = 0;
        }

        // Reset the friend actions count timer (the "come back in X hours" cooldown)
        if (decoded.allFriendActionsCount && typeof decoded.allFriendActionsCount === "object") {
          logger.debug({ mayhemId, before: decoded.allFriendActionsCount.time }, "allFriendActionsCount before reset");
          decoded.allFriendActionsCount.time = 0;
          decoded.allFriendActionsCount.count = 0;
          logger.debug({ mayhemId, after: decoded.allFriendActionsCount.time }, "allFriendActionsCount after reset");
        }

        logger.info({ mayhemId, resetType: "friendDailyActions" }, "Reset friend-specific daily action timers");

        decoded.friendListData = [];
        decoded.friendListDataIsCreatedAndSaved = false;
        decoded.numSavedFriends = 0;
        decoded.friendListDataIsCreatedAndSaved = false;
        decoded.numSavedFriends = 0;

        const encodedData = LandMessage.encode(decoded).finish();
        await fsp.writeFile(savePath, Buffer.from(encodedData));

        logger.info({ mayhemId }, "Reset friend-specific daily action timers");

        res.type("application/xml");
        res.send(`<?xml version="1.0" encoding="UTF-8"?><Resources><URI>OK</URI></Resources>`);
      } catch (e) {
        logger.error(e, "Error reading/writing land file for resetTimers:");
        res.status(500).send("Failed to reset timers");
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET admin/inspectLand - inspect saved LandMessage for debugging
router.get("/admin/inspectLand/:mayhemId", async (req, res, next) => {
  try {
    const mayhemId = req.params.mayhemId;
    const QUERY = `SELECT LandSavePath FROM UserData WHERE MayhemId = ? OR UserId = ?`;

    db.get(QUERY, [mayhemId, mayhemId], async (err, row) => {
      if (err) {
        logger.error(err, "Error querying UserData for inspectLand:");
        res.status(500).send("Internal error");
        return;
      }

      if (!row || !row.LandSavePath) {
        res.status(404).send({ error: "No saved land for that user" });
        return;
      }

      try {
        const data = await fsp.readFile(row.LandSavePath);
        const LandMessage = pb.lookupType("Data.LandMessage");
        let decoded;
        try {
          decoded = LandMessage.decode(data);
        } catch (e) {
          res.status(500).send({ error: "Failed to decode LandMessage", detail: e.message });
          return;
        }

        const obj = LandMessage.toObject(decoded, {
          longs: String,
          enums: String,
          defaults: true,
          arrays: true,
          objects: true,
        });

        const output = {
          id: obj.id,
          friendData: obj.friendData,
          friendListData: obj.friendListData,
          allFriendActionsCount: obj.allFriendActionsCount,
          friendListDataIsCreatedAndSaved: obj.friendListDataIsCreatedAndSaved,
          numSavedFriends: obj.numSavedFriends,
          customFriendActionData: obj.customFriendActionData && obj.customFriendActionData.length ? obj.customFriendActionData : undefined,
          timerData: obj.timerData && obj.timerData.length ? obj.timerData : undefined,
          innerLandUpdateTime: obj.innerLandData && obj.innerLandData.updateTime ? obj.innerLandData.updateTime : undefined,
          userData: obj.userData
            ? {
                lastBonusCollection: obj.userData.lastBonusCollection,
                lastBonus: obj.userData.lastBonus,
                lastVandalismFeedPosted: obj.userData.lastVandalismFeedPosted,
                lastStealBuildingFeedPosted: obj.userData.lastStealBuildingFeedPosted,
                creationTime: obj.userData.creationTime,
                updateTime: obj.userData.updateTime,
                numSavedFriends: obj.userData.numSavedFriends,
              }
            : undefined,
          full: obj,
        };

        res.json(output);
      } catch (e) {
        logger.error(e, "Error reading land file for inspectLand:");
        res.status(500).send({ error: "Failed to read land file" });
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
