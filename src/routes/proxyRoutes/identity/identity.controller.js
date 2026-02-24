import { Router, raw } from "express";

import nodemailer from "nodemailer";

import crypto from "crypto";

import { dbGet, dbAll, dbRun } from "../../../lib/db.js";
import { logger } from "../../../lib/logger.js";

import config from "../../../../config.json" with { type: "json" };

const router = Router();

// In-memory cache for friend search results (track which user was just searched for)
const friendSearchCache = {};

// Log all incoming requests to debug routing
router.use((req, res, next) => {
  if (req.path.includes('friend') || req.path.includes('invitation')) {
    logger.debug({ 
      method: req.method, 
      path: req.path
    }, "Identity route - friend/invitation related request");
  }
  next();
});


function randomInt(min, max) { // https://stackoverflow.com/questions/4959975/generate-random-number-between-two-numbers-in-javascript
  return Math.floor(Math.random() * (max - min + 1) + min);
}

router.get("/pids//personas", async (req, res, next) => {
  try {
    res
      .status(404)
      .send({ error: "not_found", error_description: "no mediator found" });
  } catch (error) {
    next(error);
  }
});

router.get("/pids/:who/personas", async (req, res, next) => {
  // EA Accounts
  try {
    const token = req.headers["authorization"].split(" ")[1];
    if (!token) {
      res.status(400).send({ message: "No Authorization Header" });
      return;
    }

    const USER_BY_UID_QUERY =
      "SELECT UserId, UserAccessToken, UserEmail, UserName FROM UserData WHERE UserId = ?;";
    const row = await dbGet(USER_BY_UID_QUERY, [req.params.who]);
    
    if (!row) {
      res
        .status(400)
        .send({ message: "No user could be found with that UserId" });
      return;
    }

    if (row.UserAccessToken != token) {
      res.status(400).send({ message: "Tokens do not match" });
      return;
    }

    res.status(200).send({
      personas: {
        persona: [
          {
            dateCreated: "2024-12-12T15:42Z",
            displayName: row.UserName ? row.UserName : "user",
            isVisible: true,
            lastAuthenticated: "",
            name: row.UserName ? row.UserName : "user",
            namespaceName: row.UserEmail ? "cem_ea_id" : "gsp-redcrow-simpsons4",
            personaId: row.UserId,
            pidId: row.UserId,
            showPersona: "EVERYONE",
            status: "ACTIVE",
            statusReasonCode: "",
          },
        ],
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/pids/me/personas/:who", async (req, res, next) => {
  // Anonymous Accounts
  try {
    const token = req.headers["authorization"].split(" ")[1];
    if (!token) {
      res.status(400).send({ message: "No Authorization Header" });
      return;
    }

    const USER_BY_UID_QUERY =
      "SELECT UserId, UserAccessToken, UserEmail, UserName FROM UserData WHERE UserId = ?;";
    const row = await dbGet(USER_BY_UID_QUERY, [req.params.who]);
    
    if (!row) {
      res
        .status(400)
        .send({ message: "No user could be found with that UserId" });
      return;
    }

    if (row.UserAccessToken != token) {
      res.status(400).send({ message: "Tokens do not match" });
      return;
    }

    res.status(200).send({
      persona: {
        anonymousId: "user",
        dateCreated: "2024-12-12T15:42Z",
        displayName: row.UserName ? row.UserName : "user",
        isVisible: true,
        lastAuthenticated: "",
        name: row.UserName ? row.UserName : "user",
        namespaceName: row.UserEmail ? "cem_ea_id" : "gsp-redcrow-simpsons4",
        personaId: row.UserId,
        pidId: row.UserId,
        showPersona: "EVERYONE",
        status: "ACTIVE",
        statusReasonCode: "",
      },
    });
  } catch (error) {
    next(error);
  }
});

// Lookup personas by displayName (e.g. email) - used by client to resolve friends
router.get("/personas", async (req, res, next) => {
  try {
    const { displayName, namespaceName } = req.query;
    if (!displayName) {
      res.status(400).send({ message: "Missing displayName" });
      return;
    }

    logger.info({ displayName, namespaceName }, "Searching personas by displayName");

    let query = "SELECT UserId, UserName, UserEmail, MayhemId FROM UserData WHERE ";
    let params = [];

    // Handle wildcard search (e.g., "storm*" or "*storm*")
    if (displayName.includes("*")) {
      const pattern = displayName.replace(/\*/g, "%");
      query += "(UserEmail LIKE ? OR UserName LIKE ?)";
      params = [pattern, pattern];
    } else {
      // Exact match search
      query += "(UserEmail = ? OR UserName = ?)";
      params = [displayName, displayName];
    }

    const rows = await dbAll(query, params);

    if (!rows || rows.length === 0) {
      // Return empty persona list instead of 404 so client can handle no results
      logger.info({ displayName }, "No personas found for search");
      res.status(200).send({ personas: { persona: [] } });
      return;
    }

    logger.info({ displayName, count: rows.length }, "Found personas for search");

    const personaList = rows.map((row) => {
      const userId = String(row.UserId);
      const mayhemId = row.MayhemId ? String(row.MayhemId) : String(row.UserId);
      
      // Store this friend search result in cache so we can use it for fakefriend preview
      friendSearchCache[userId] = {
        userId,
        mayhemId,
        email: row.UserEmail,
        name: row.UserName || row.UserEmail,
        timestamp: Date.now()
      };

      return {
        dateCreated: new Date().toISOString(),
        displayName: row.UserName ? row.UserName : row.UserEmail,
        isVisible: true,
        lastAuthenticated: "",
        name: row.UserName ? row.UserName : row.UserEmail,
        namespaceName: row.UserEmail ? "cem_ea_id" : "gsp-redcrow-simpsons4",
        personaId: String(row.UserId),
        pidId: String(row.UserId),
        showPersona: "EVERYONE",
        status: "ACTIVE",
        statusReasonCode: "",
        // Additional fields for game compatibility
        userId: String(row.UserId),
        mayhemId: row.MayhemId ? String(row.MayhemId) : String(row.UserId),
        accountId: String(row.UserId),
      };
    });

    res.status(200).send({
      personas: {
        persona: personaList,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/geoagerequirements", async (req, res, next) => {
  // NOTE: Currently uses hardcoded values. In the future, these should be moved to config.json for dynamic configuration
  try {
    res.status(200).send({
      geoAgeRequirements: {
        country: "NO",
        minAgeWithConsent: "3",
        minLegalContactAge: 13,
        minLegalRegAge: 13,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/progreg/code", raw({ type: "*/*" }), async (req, res, next) => {
  try {
    const token = req.headers["authorization"].split(" ")[1];
    if (!token) {
      res.status(400).send({ message: "No Authorization Header" });
      return;
    }

    let body;
    try {
      body = JSON.parse(req.body.toString().trim());
    } catch (error) {
      res.status(400).send({ message: "Invalid JSON" });
      return;
    }

    const { codeType } = body;
    if (!codeType || codeType !== "EMAIL") {
      res.status(400).send({ message: "Invalid codeType" });
      return;
    }

    const { email } = body;
    if (!email) {
      res.status(400).send({ message: "Missing Field: email" });
      return;
    }

    const USER_BY_TOKEN = "SELECT 1 FROM UserData WHERE UserAccessToken = ?;"; // Only check for a valid token, don't get any info from it
    const row = await dbGet(USER_BY_TOKEN, [token]);

    if (!row) {
      res.status(400).send({ message: "Invalid token" });
      return;
    }

    const USER_BY_EMAIL = "SELECT 1 FROM UserData WHERE UserEmail = ?;";
    const row2 = await dbGet(USER_BY_EMAIL, [email]);
    
    if (!row2) {
      res.status(400).send({ message: "Invalid email" });
      return;
    }

    if(config.useTSTO_API) {
      try {
        const url = `https://api.tsto.app/api/auth/sendCode?apikey=${encodeURIComponent(config.TSTO_APIkey)}&emailAddress=${encodeURIComponent(email)}&teamName=${encodeURIComponent(config.TSTO_APIteam)}`;
        const resp = await fetch(url, { method: "POST" });
        const data = await resp.json();

        const UPDATE_CRED_BY_EMAIL = "UPDATE UserData SET UserCred = ? WHERE UserEmail = ?;";
        await dbRun(UPDATE_CRED_BY_EMAIL, [data.code, email]);
      } catch (err) {
        logger.error(err.message);
      }
    } else if (config.useSMTP) {
      const transporter = nodemailer.createTransport({
        host: config.SMTPhost,
        port: config.SMTPport,
        secure: config.SMTPsecure,
        auth: {
          user: config.SMTPuser,
          pass: config.SMTPpass,
        }
      });

      const newCode = randomInt(10000, 99999);

      const mailOptions = {
        from: config.SMTPuser,
        to: email,
        subject: `Verification Code For The Simpsons: Tapped Out - ${newCode}`,
        text: `Your Code: ${newCode}`
      };

      const UPDATE_CRED_BY_EMAIL = "UPDATE UserData SET UserCred = ? WHERE UserEmail = ?;";
      await dbRun(UPDATE_CRED_BY_EMAIL, [newCode, email]);

      transporter.sendMail(mailOptions, function(error, info) {
        if (error) {
          logger.error(error, "Error:");
        }
      });
    }
    res.status(200).send("");
  } catch (error) {
    next(error);
  }
});

router.get("/links", async (req, res, next) => {
  try {
    const token = req.headers["authorization"].split(" ")[1];
    if (!token) {
      res.status(400).send({ message: "No Authorization Header" });
      return;
    }

    const USER_BY_TOKEN =
      "SELECT UserId FROM UserData WHERE UserAccessToken = ?;";
    const row = await dbGet(USER_BY_TOKEN, [token]);

    if (!row) {
      res.status(400).send({ message: "Invalid token" });
      return;
    }

    res.status(200).send({
      pidGamePersonaMappings: {
        pidGamePersonaMapping: [
          {
            newCreated: false,
            personaId: row.UserId,
            personaNamespace: req.query.personaNamespace
              ? req.query.personaNamespace
              : "gsp-redcrow-simpsons4",
            pidGamePersonaMappingId: row.UserId,
            pidId: row.UserId,
            status: "ACTIVE",
          },
        ],
      },
    });
  } catch (error) {
    next(error);
  }
});

// Friend invitations endpoints
router.get("/invitations/inbound", async (req, res, next) => {
  try {
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"] || req.headers["authorization"];
    if (!reqToken) {
      res.status(401).json({ error: "No auth token" });
      return;
    }
    
    const owner = await dbGet("SELECT MayhemId FROM UserData WHERE UserAccessToken = ?", [reqToken]);
    if (!owner) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const requests = await dbAll(
      `SELECT u.MayhemId, u.UserId, u.UserName, f.createdAt FROM UserData u
       INNER JOIN Friends f ON u.MayhemId = f.ownerMayhemId
       WHERE f.friendMayhemId = ? AND f.status = 'pending'
       ORDER BY f.createdAt DESC`,
      [owner.MayhemId]
    );

    const entries = (requests || []).map(u => ({
      timestamp: (u.createdAt * 1000) * 1000,
      userId: u.MayhemId,
      dateTime: new Date(u.createdAt * 1000).toISOString(),
      inviteTags: {
        invite_surface: "unknown"
      },
      userType: "NUCLEUS_USER",
      displayName: u.UserName,
      personaId: u.MayhemId,
      nickName: u.UserName
    }));

    const pagingInfo = {
      size: entries.length,
      offset: 0,
      totalSize: entries.length
    };

    res.json({ entries, pagingInfo });
  } catch (error) {
    logger.error(error, "Error getting inbound invitations");
    res.status(500).json({ error: error.message });
  }
});

router.get("/invitations/outbound", async (req, res, next) => {
  try {
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"] || req.headers["authorization"];
    if (!reqToken) {
      res.status(401).json({ error: "No auth token" });
      return;
    }
    
    const owner = await dbGet("SELECT MayhemId FROM UserData WHERE UserAccessToken = ?", [reqToken]);
    if (!owner) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const requests = await dbAll(
      `SELECT u.MayhemId, u.UserId, u.UserName, f.createdAt FROM UserData u
       INNER JOIN Friends f ON u.MayhemId = f.friendMayhemId
       WHERE f.ownerMayhemId = ? AND f.status = 'pending'
       ORDER BY f.createdAt DESC`,
      [owner.MayhemId]
    );

    const entries = (requests || []).map(u => ({
      timestamp: (u.createdAt * 1000) * 1000,
      userId: u.MayhemId,
      dateTime: new Date(u.createdAt * 1000).toISOString(),
      inviteTags: {
        invite_surface: "unknown"
      },
      userType: "NUCLEUS_USER",
      displayName: u.UserName,
      personaId: u.MayhemId,
      nickName: u.UserName
    }));

    const pagingInfo = {
      size: entries.length,
      offset: 0,
      totalSize: entries.length
    };

    res.json({ entries, pagingInfo });
  } catch (error) {
    logger.error(error, "Error getting outbound invitations");
    res.status(500).json({ error: error.message });
  }
});

// Send friend invitation
router.post("/invitations", async (req, res, next) => {
  try {
    logger.info({ headers: req.headers, body: req.body }, "POST /invitations received");
    
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"] || req.headers["authorization"] || req.headers["x-auth-token"];
    if (!reqToken) {
      logger.warn({ headers: Object.keys(req.headers) }, "No auth token found");
      res.status(401).json({ error: "No auth token" });
      return;
    }
    
    const owner = await dbGet("SELECT MayhemId, UserId FROM UserData WHERE UserAccessToken = ?", [reqToken]);
    if (!owner) {
      logger.warn({ token: reqToken }, "Token not found in database");
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const fromId = owner.MayhemId || String(owner.UserId);
    const toId = req.body?.toId || req.body?.friendMayhemId || req.body?.targetId || req.body?.personaId || req.body?.recipientId;

    if (!toId) {
      logger.warn({ body: req.body }, "Missing target friend ID");
      res.status(400).json({ error: "Missing target friend ID" });
      return;
    }

    const now = Math.floor(Date.now() / 1000);

    const existing = await dbGet(
      "SELECT status FROM Friends WHERE ownerMayhemId = ? AND friendMayhemId = ? LIMIT 1",
      [fromId, String(toId)]
    );

    if (existing) {
      logger.info({ fromId, toId, status: existing.status }, "Friend request already exists");
      res.status(200).json({ success: true, status: existing.status });
      return;
    }

    await dbRun(
      "INSERT INTO Friends (ownerMayhemId, friendMayhemId, status, createdAt) VALUES (?, ?, ?, ?)",
      [fromId, String(toId), "pending", now]
    );

    logger.info({ fromId, toId }, "Friend invitation created");
    res.status(200).json({ success: true, status: "pending" });
  } catch (error) {
    logger.error(error, "Error sending friend invitation");
    res.status(500).json({ error: error.message });
  }
});

// /friends/inviteFriend - Endpoint called by game to send friend invites
router.post("/friends/inviteFriend", async (req, res, next) => {
  try {
    logger.info({ 
      headers: req.headers,
      body: req.body,
      url: req.url
    }, "🎮 FRIEND INVITE REQUEST RECEIVED AT /proxy/identity/friends/inviteFriend");

    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"] || req.headers["authorization"] || req.headers["x-auth-token"];
    if (!reqToken) {
      logger.warn({ headers: Object.keys(req.headers) }, "No auth token in /friends/inviteFriend");
      res.status(401).json({ error: "No auth token" });
      return;
    }
    
    const owner = await dbGet("SELECT MayhemId, UserId FROM UserData WHERE UserAccessToken = ?", [reqToken]);
    if (!owner) {
      logger.warn({ token: reqToken }, "Token not found in /friends/inviteFriend");
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const fromId = owner.MayhemId || String(owner.UserId);
    // Try multiple possible field names for the target friend ID
    const toId = req.body?.toId || req.body?.targetId || req.body?.friendId || req.body?.personaId || req.body?.userId;

    if (!toId) {
      logger.warn({ body: req.body }, "Missing target friend ID in /friends/inviteFriend");
      res.status(400).json({ error: "Missing target friend ID" });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const toIdStr = String(toId);

    // Check if request already exists
    const existing = await dbGet(
      "SELECT status FROM Friends WHERE ownerMayhemId = ? AND friendMayhemId = ? LIMIT 1",
      [fromId, toIdStr]
    );

    if (existing) {
      logger.info({ fromId, toId: toIdStr, status: existing.status }, "Friend request already exists in /friends/inviteFriend");
      res.type("application/xml").send(
        `<?xml version="1.0" encoding="UTF-8"?>
<FriendInvitationResponse>
  <resultCode>0</resultCode>
  <success>true</success>
  <status>${existing.status}</status>
</FriendInvitationResponse>`
      );
      return;
    }

    // Create new friend invitation
    await dbRun(
      "INSERT INTO Friends (ownerMayhemId, friendMayhemId, status, createdAt) VALUES (?, ?, ?, ?)",
      [fromId, toIdStr, "pending", now]
    );

    logger.info({ fromId, toId: toIdStr }, "Friend invitation created via /friends/inviteFriend");
    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>
<FriendInvitationResponse>
  <resultCode>0</resultCode>
  <success>true</success>
  <status>pending</status>
</FriendInvitationResponse>`
    );
  } catch (error) {
    logger.error(error, "Error in /friends/inviteFriend");
    res.status(500).json({ error: error.message });
  }
});

// /friends/confirmInvitation - Accept a friend invitation
router.post("/friends/confirmInvitation", async (req, res, next) => {
  try {
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"] || req.headers["authorization"] || req.headers["x-auth-token"];
    if (!reqToken) {
      logger.warn({ headers: Object.keys(req.headers) }, "No auth token in /friends/confirmInvitation");
      res.status(401).json({ error: "No auth token" });
      return;
    }
    
    const owner = await dbGet("SELECT MayhemId, UserId FROM UserData WHERE UserAccessToken = ?", [reqToken]);
    if (!owner) {
      logger.warn({ token: reqToken }, "Token not found in /friends/confirmInvitation");
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const userId = owner.MayhemId || String(owner.UserId);
    const fromId = req.body?.fromId || req.body?.senderId || req.body?.friendId;

    if (!fromId) {
      logger.warn({ body: req.body }, "Missing sender ID in /friends/confirmInvitation");
      res.status(400).json({ error: "Missing sender ID" });
      return;
    }

    // Update friend status to accepted (both directions)
    await dbRun(
      "UPDATE Friends SET status = ? WHERE (ownerMayhemId = ? AND friendMayhemId = ?) OR (ownerMayhemId = ? AND friendMayhemId = ?)",
      ["accepted", String(fromId), userId, userId, String(fromId)]
    );

    logger.info({ userId, fromId }, "Friend invitation accepted via /friends/confirmInvitation");
    res.status(200).json({ success: true, status: "accepted" });
  } catch (error) {
    logger.error(error, "Error in /friends/confirmInvitation");
    res.status(500).json({ error: error.message });
  }
});

// /friends/deleteFriend - Remove a friend
router.post("/friends/deleteFriend", async (req, res, next) => {
  try {
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"] || req.headers["authorization"] || req.headers["x-auth-token"];
    if (!reqToken) {
      logger.warn({ headers: Object.keys(req.headers) }, "No auth token in /friends/deleteFriend");
      res.status(401).json({ error: "No auth token" });
      return;
    }
    
    const owner = await dbGet("SELECT MayhemId, UserId FROM UserData WHERE UserAccessToken = ?", [reqToken]);
    if (!owner) {
      logger.warn({ token: reqToken }, "Token not found in /friends/deleteFriend");
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const userId = owner.MayhemId || String(owner.UserId);
    const friendId = req.body?.friendId || req.body?.targetId || req.body?.personaId;

    if (!friendId) {
      logger.warn({ body: req.body }, "Missing friend ID in /friends/deleteFriend");
      res.status(400).json({ error: "Missing friend ID" });
      return;
    }

    // Delete friendship (both directions)
    await dbRun(
      "DELETE FROM Friends WHERE (ownerMayhemId = ? AND friendMayhemId = ?) OR (ownerMayhemId = ? AND friendMayhemId = ?)",
      [userId, String(friendId), String(friendId), userId]
    );

    logger.info({ userId, friendId }, "Friend removed via /friends/deleteFriend");
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error(error, "Error in /friends/deleteFriend");
    res.status(500).json({ error: error.message });
  }
});

// Catch-all for unknown /friends requests for debugging
router.all("/friends/*", (req, res) => {
  logger.error({ 
    method: req.method, 
    path: req.path, 
    url: req.url,
    body: req.body,
    headers: Object.keys(req.headers),
    fullUrl: `${req.method} ${req.originalUrl}`
  }, "UNKNOWN FRIEND ENDPOINT - RETURNING 404");
  res.status(404).json({ error: "Not found" });
});

export default router;
export { friendSearchCache };
