import { Router, raw } from "express";
import fsp from "fs/promises";
import fs from "fs";
import path from "path";
import pb from "../../../lib/protobuf.js";
import db, { dbGet, dbRun } from "../../../lib/db.js";
import { logger } from "../../../lib/logger.js";
import { v4 as uuidv4 } from "uuid";
import config from "../../../../config.json" with { type: "json" };
import sessionManager from "../../../lib/sessionManager.js";
import { clearEventsFile } from "./event.controller.js";

const router = Router();

// Error response constants
const ERROR_MISSING_TOKEN = `<?xml version="1.0" encoding="UTF-8"?><error code="400" type="MISSING_VALUE" field="nucleus_token"/>`;
const ERROR_NOT_FOUND = `<?xml version="1.0" encoding="UTF-8"?><error code="404" type="NOT_FOUND" field="mayhemId"/>`;
const ERROR_BAD_TOKEN = `<?xml version="1.0" encoding="UTF-8"?><error code="400" type="BAD_REQUEST" field="Invalid AccessToken for specified MayhemId"/>`;
const LAND_UPDATE_RESPONSE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<WholeLandUpdateResponse/>`;

// Generate a new WholeLandToken for land updates
router.post("/bg_gameserver_plugin/protoWholeLandToken/:mayhemId", async (req, res, next) => {

  try {
    const mayhemId = req.params.mayhemId;
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];

    if (!reqToken) {
      res.type("application/xml").status(400).send(ERROR_MISSING_TOKEN);
      return;
    }

    const userData = await dbGet(
      `SELECT UserId, UserName, UserAccessToken, WholeLandToken FROM UserData WHERE MayhemId = ?`,
      [mayhemId]
    );

    if (!userData) {
      res.type("application/xml").status(404).send(ERROR_NOT_FOUND);
      return;
    }

    if (reqToken !== userData.UserAccessToken) {
      res.type("application/xml").status(400).send(ERROR_BAD_TOKEN);
      return;
    }

    // Track player session here - this is where the player proves their identity
    if (mayhemId && userData.UserId) {
      sessionManager.trackSession(
        userData.UserId.toString(),
        mayhemId.toString(),
        req.hostname || req.get('host') || 'default-server',
        { action: 'TokenRequest', timestamp: Date.now(), username: userData.UserName }
      );
      dbRun("UPDATE UserData SET LastPlayedTime = ? WHERE MayhemId = ?", [Date.now(), mayhemId]);
    }

    const newWholeLandToken = uuidv4();
    await dbRun(
      `UPDATE UserData SET WholeLandToken = ? WHERE MayhemId = ?`,
      [newWholeLandToken, mayhemId]
    );

    const WholeLandTokenResponse = pb.lookupType("Data.WholeLandTokenResponse");
    let message = WholeLandTokenResponse.create({ token: newWholeLandToken, conflict: "0" });
    res.type("application/x-protobuf");
    res.send(WholeLandTokenResponse.encode(message).finish());
  } catch (error) {
    next(error);
  }
});

// Check existing WholeLandToken
router.get("/bg_gameserver_plugin/checkToken/:mayhemId/protoWholeLandToken/", async (req, res, next) => {
  const QUERY = `SELECT UserAccessToken, WholeLandToken FROM UserData WHERE MayhemId = ?`;

  try {
    const mayhemId = req.params.mayhemId;
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];

    if (!reqToken) {
      res.type("application/xml").status(400).send(ERROR_MISSING_TOKEN);
      return;
    }

    const userData = await dbGet(
      `SELECT UserAccessToken, WholeLandToken FROM UserData WHERE MayhemId = ?`,
      [mayhemId]
    );

    if (!userData) {
      res.type("application/xml").status(404).send(ERROR_NOT_FOUND);
      return;
    }

    if (reqToken !== userData.UserAccessToken) {
      res.type("application/xml").status(400).send(ERROR_BAD_TOKEN);
      return;
    }

    const WholeLandTokenResponse = pb.lookupType("Data.WholeLandTokenResponse");
    let message = WholeLandTokenResponse.create({ token: userData.WholeLandToken, conflict: "0" });
    res.type("application/x-protobuf");
    res.send(WholeLandTokenResponse.encode(message).finish());
  } catch (error) {
    next(error);
  }
});

// Delete/clear WholeLandToken
router.post(
  "/bg_gameserver_plugin/deleteToken/:mayhemId/protoWholeLandToken/",
  raw({ type: "application/x-protobuf" }),
  async (req, res, next) => {
    try {
      const mayhemId = req.params.mayhemId;
      const DeleteTokenRequest = pb.lookupType("Data.DeleteTokenRequest");
      const decodedBody = DeleteTokenRequest.decode(req.body);

      const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];
      if (!reqToken) {
        res.type("application/xml").status(400).send(ERROR_MISSING_TOKEN);
        return;
      }

      const userData = await dbGet(
        `SELECT UserAccessToken, WholeLandToken FROM UserData WHERE MayhemId = ?`,
        [mayhemId]
      );

      if (!userData) {
        res.type("application/xml").status(404).send(ERROR_NOT_FOUND);
        return;
      }

      if (reqToken !== userData.UserAccessToken) {
        res.type("application/xml").status(400).send(ERROR_BAD_TOKEN);
        return;
      }

      if (decodedBody.token !== userData.WholeLandToken) {
        const DeleteTokenResponse = pb.lookupType("Data.DeleteTokenResponse");
        let message = DeleteTokenResponse.create({ result: "0" });
        res.type("application/x-protobuf");
        res.send(DeleteTokenResponse.encode(message).finish());
        return;
      }

      await dbRun(`UPDATE UserData SET WholeLandToken = ? WHERE MayhemId = ?`, ["", mayhemId]);

      const DeleteTokenResponse = pb.lookupType("Data.DeleteTokenResponse");
      let message = DeleteTokenResponse.create({ result: "1" });
      res.type("application/x-protobuf");
      res.send(DeleteTokenResponse.encode(message).finish());
    } catch (error) {
      next(error);
    }
  },
);

// GET protoland - retrieve land data
router.get(
  "/bg_gameserver_plugin/protoland/:landId",
  raw({ type: "application/x-protobuf" }),
  async (req, res, next) => {
    const QUERY = `SELECT UserAccessToken, WholeLandToken, LandSavePath, MayhemId FROM UserData WHERE MayhemId = ? OR UserId = ?`;

    try {
      const landId = req.params.landId;
      const wholeLandToken = req.headers["land-update-token"];
      const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];

      if (!reqToken) {
        res.type("application/xml").status(400).send(
          `<?xml version="1.0" encoding="UTF-8"?><error code="400" type="MISSING_VALUE" field="nucleus_token"/>`,
        );
        return;
      }

      let requestingUserMayhemId = null;
      try {
        const USER_BY_TOKEN = "SELECT MayhemId, UserId FROM UserData WHERE UserAccessToken = ?;";
        const requestingUser = await dbGet(USER_BY_TOKEN, [reqToken]);
        if (requestingUser) {
          requestingUserMayhemId = requestingUser.MayhemId ? requestingUser.MayhemId.toString() : null;
          // Update session activity - player is actively playing
          if (requestingUser.UserId && requestingUserMayhemId) {
            sessionManager.updateActivity(requestingUser.UserId.toString());
          }
        }
      } catch (err) {
        logger.error(err, "Error getting requesting user from token");
      }

      const userData = await dbGet(QUERY, [landId, landId]);

      if (!userData) {
        const LandMessage = pb.lookupType("Data.LandMessage");
        const emptyLand = LandMessage.create({ id: landId });
        res.type("application/x-protobuf");
        res.send(LandMessage.encode(emptyLand).finish());
        return;
      }

      const landOwnerMayhemId = userData.MayhemId ? userData.MayhemId.toString() : landId;
      const isOwnLand = reqToken === userData.UserAccessToken;

      // Track player session for the requesting user if they're accessing their own land
      if (isOwnLand && userData.MayhemId && userData.UserId) {
        const hostname = req.hostname || req.get('host') || 'default-server';
        sessionManager.trackSession(
          userData.UserId.toString(),
          userData.MayhemId.toString(),
          hostname,
          {
            action: 'GetLand',
            timestamp: Date.now()
          }
        );
        
        // Update LastPlayedTime in database for persistent tracking
        dbRun(
          "UPDATE UserData SET LastPlayedTime = ? WHERE MayhemId = ?",
          [Date.now(), userData.MayhemId],
          (err) => {
            if (err && global.logger) {
              global.logger.error(err, `Failed to update LastPlayedTime for ${userData.MayhemId}`);
            }
          }
        );
      }

      let isFriend = false;
      if (!isOwnLand && requestingUserMayhemId) {
        try {
          const FRIEND_CHECK = "SELECT 1 FROM Friends WHERE ownerMayhemId = ? AND friendMayhemId = ? AND status = 'accepted' LIMIT 1;";
          const friendRecord = await dbGet(FRIEND_CHECK, [requestingUserMayhemId, landOwnerMayhemId]);
          isFriend = !!friendRecord;
        } catch (err) {
          logger.error(err, "Error checking friend status");
        }
      }

      if (!isOwnLand && !isFriend) {
        res.type("application/xml").status(400).send(
          `<?xml version="1.0" encoding="UTF-8"?><error code="400" type="BAD_REQUEST" field="Invalid AcessToken for specified MayhemId"/>`,
        );
        return;
      }

      const savePath = userData.LandSavePath;
      if (!savePath || savePath == "") {
        res.type("application/xml").status(404).send(
          `<?xml version="1.0" encoding="UTF-8"?><error code="404" type="NO_SUCH_RESOURCE" field="LAND_NOT_FOUND"/>`,
        );
        return;
      }

      try {
        const st = await fsp.stat(savePath);
        if (st.size == 0) {
          res.type("application/xml").status(404).send(
            `<?xml version="1.0" encoding="UTF-8"?><error code="404" type="NO_SUCH_RESOURCE" field="LAND_NOT_FOUND"/>`,
          );
          return;
        }
      } catch (err) {
        res.type("application/xml").status(404).send(
          `<?xml version="1.0" encoding="UTF-8"?><error code="404" type="NO_SUCH_RESOURCE" field="LAND_NOT_FOUND"/>`,
        );
        return;
      }

      const serializedSaveData = await fsp.readFile(savePath);
      try {
        const LandMessage = pb.lookupType("Data.LandMessage");
        const decodedMessage = LandMessage.decode(serializedSaveData);
        decodedMessage.id = landId;

        // If friend visiting (not their own land), populate visitor data from events
        if (!isOwnLand && isFriend && requestingUserMayhemId) {
          try {
            const uniqueVisitors = new Set();
            const eventsFilePath = `${config.dataDirectory}/${landOwnerMayhemId}/${landOwnerMayhemId}.events`;
            
            if (fs.existsSync(eventsFilePath)) {
              try {
                const eventsData = fs.readFileSync(eventsFilePath);
                const EventsMessage = pb.lookupType("Data.EventsMessage");
                const eventsMessage = EventsMessage.decode(eventsData);
                
                if (eventsMessage.event && eventsMessage.event.length > 0) {
                  eventsMessage.event.forEach(event => {
                    uniqueVisitors.add(event.fromPlayerId);
                  });
                }
              } catch (err) {
                logger.warn({ err, filePath: eventsFilePath }, "Could not load events file for visitor list");
              }
            }
            
            const visitors = Array.from(uniqueVisitors);
            const friendListDataObjects = visitors.map(visitorId => {
              const EntityHeader = pb.lookupType("Data.LandMessage.EntityHeader");
              return {
                header: EntityHeader.create({ id: 0 }),
                friendID: visitorId,
                hasBeenVisited: true,
                hideInMap: false,
                isOrigin: false
              };
            });
            decodedMessage.friendListData = friendListDataObjects;
          } catch (err) {
            logger.warn(err, "Error populating friendListData");
          }
        }

        res.type("application/x-protobuf");
        res.send(LandMessage.encode(decodedMessage).finish());
      } catch (error) {
        logger.error(error, `Error decoding/encoding protoland for ${landId}`);
        res.status(500).send("Internal error");
      }
    } catch (error) {
      next(error);
    }
  },
);

// POST protoland - save land data (same as PUT)
router.post(
  "/bg_gameserver_plugin/protoland/:landId",
  raw({ type: "application/x-protobuf", limit: "52428800" }),
  async (req, res, next) => {
    try {
      const landId = req.params.landId;
      const wholeLandToken = req.headers["land-update-token"];
      const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];

      if (!reqToken) {
        res.type("application/xml").status(400).send(ERROR_MISSING_TOKEN);
        return;
      }

      const userData = await dbGet(
        `SELECT UserAccessToken, WholeLandToken, LandSavePath FROM UserData WHERE MayhemId = ?`,
        [landId]
      );

      if (!userData) {
        res.type("application/xml").status(404).send(ERROR_NOT_FOUND);
        return;
      }

      if (reqToken !== userData.UserAccessToken) {
        res.type("application/xml").status(400).send(ERROR_BAD_TOKEN);
        return;
      }

      let savePath = userData.LandSavePath;
      if (!savePath) {
        savePath = `${config.dataDirectory}/${landId}/${landId}.land`;
        await dbRun(
          `UPDATE UserData SET LandSavePath = ? WHERE MayhemId = ?`,
          [savePath, landId]
        );
      }

      const dirPath = `${config.dataDirectory}/${landId}`;
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
      fs.writeFileSync(savePath, req.body, { flag: "w+" });
      await clearEventsFile(landId);
      res.type("application/xml").send(LAND_UPDATE_RESPONSE);
    } catch (error) {
      next(error);
    }
  },
);

// PUT protoland - save land data (same as POST)
router.put(
  "/bg_gameserver_plugin/protoland/:landId",
  raw({ type: "application/x-protobuf", limit: "52428800" }),
  async (req, res, next) => {
    try {
      const landId = req.params.landId;
      const wholeLandToken = req.headers["land-update-token"];
      const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];

      if (!reqToken) {
        res.type("application/xml").status(400).send(ERROR_MISSING_TOKEN);
        return;
      }

      const userData = await dbGet(
        `SELECT UserAccessToken, WholeLandToken, LandSavePath FROM UserData WHERE MayhemId = ?`,
        [landId]
      );

      if (!userData) {
        res.type("application/xml").status(404).send(ERROR_NOT_FOUND);
        return;
      }

      if (reqToken !== userData.UserAccessToken) {
        res.type("application/xml").status(400).send(ERROR_BAD_TOKEN);
        return;
      }

      let savePath = userData.LandSavePath;
      if (!savePath) {
        savePath = `${config.dataDirectory}/${landId}/${landId}.land`;
        await dbRun(
          `UPDATE UserData SET LandSavePath = ? WHERE MayhemId = ?`,
          [savePath, landId]
        );
      }

      const dirPath = `${config.dataDirectory}/${landId}`;
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
      fs.writeFileSync(savePath, req.body, { flag: "w+" });
      await clearEventsFile(landId);
      res.type("application/xml").send(LAND_UPDATE_RESPONSE);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
