import { Router, raw } from "express";
import fsp from "fs/promises";
import pb from "../../../lib/protobuf.js";
import { dbGet, dbAll, dbRun } from "../../../lib/db.js";
import { logger } from "../../../lib/logger.js";

const router = Router();

// Cache protobuf types for reuse
const GetFriendDataResponse = pb.lookupType("Data.GetFriendDataResponse");
const LandMessage = pb.lookupType("Data.LandMessage");

// Load friendData from land file
const loadFriendDataFromLand = async (landSavePath) => {
  if (!landSavePath) return null;
  try {
    const landData = await fsp.readFile(landSavePath);
    const decodedLand = LandMessage.decode(landData);
    return decodedLand.friendData || null;
  } catch (err) {
    return null;
  }
};

// Helper to get user by ID - reusable across endpoints
const getUserByIdParam = async (idParam) => {
  return await dbGet(
    "SELECT MayhemId, UserId FROM UserData WHERE MayhemId = ? OR UserId = ? LIMIT 1",
    [idParam, idParam]
  );
};

// Helper to format friend entry - consistent formatting
const formatFriendEntry = (user, createdAt) => ({
  timestamp: (createdAt * 1000) * 1000,
  friendType: "OLD",
  userId: user.MayhemId,
  favorite: false,
  dateTime: new Date(createdAt * 1000).toISOString(),
  edgeAttribute: { tags: { invite_surface: "unknown" } },
  userType: "NUCLEUS_USER",
  displayName: user.UserName,
  personaId: user.MayhemId,
  nickName: user.UserName,
  _friendType: "OLD"
});

// Helper to fetch friends list with pagination
const getFriendsList = async (userMayhemId, start = 0, count = 100) => {
  const countResult = await dbGet(
    `SELECT COUNT(*) as total FROM Friends WHERE ownerMayhemId = ? AND status = 'accepted'`,
    [userMayhemId]
  );
  const totalSize = countResult?.total || 0;

  const rows = await dbAll(
    `SELECT u.MayhemId, u.UserName, f.createdAt FROM UserData u
     INNER JOIN Friends f ON u.MayhemId = f.friendMayhemId
     WHERE f.ownerMayhemId = ? AND f.status = 'accepted'
     ORDER BY f.createdAt DESC
     LIMIT ? OFFSET ?`,
    [userMayhemId, count, start]
  );

  const entries = (rows || []).map(u => formatFriendEntry(u, u.createdAt));
  return { entries, totalSize };
};

// ===== FRIENDS LIST ENDPOINTS =====

// Unified friends list handler - supports both /userId and /2/users/userId patterns
const handleFriendsListRequest = async (req, res) => {
  try {
    const userId = req.params.userId;
    const start = parseInt(req.query.start) || 0;
    const count = Math.min(parseInt(req.query.count) || 100, 100); // Cap at 100 for performance
    
    if (!userId || isNaN(start) || isNaN(count)) {
      return res.json({ entries: [], pagingInfo: { size: 0, offset: 0, totalSize: 0 } });
    }

    const user = await getUserByIdParam(userId);
    if (!user) {
      return res.json({ entries: [], pagingInfo: { size: 0, offset: 0, totalSize: 0 } });
    }

    const { entries, totalSize } = await getFriendsList(user.MayhemId, start, count);
    res.json({ 
      entries, 
      pagingInfo: { 
        size: entries.length, 
        offset: start, 
        totalSize 
      } 
    });
  } catch (error) {
    logger.error(error, "Error in friends list endpoint");
    res.json({ entries: [], pagingInfo: { size: 0, offset: 0, totalSize: 0 } });
  }
};

// GET /:userId/friends - Returns the user's accepted friends
router.get("/:userId/friends", handleFriendsListRequest);

// GET /2/users/:userId/friends - Alias for when mounted at /friends
router.get("/2/users/:userId/friends", handleFriendsListRequest);

// ===== GAME ENDPOINTS =====

// GET /bg_gameserver_plugin/friendData/:service - retrieve friend list data
router.get("/bg_gameserver_plugin/friendData/:service", async (req, res, next) => {
  try {
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];
    let friendsToReturn = [];

    if (reqToken) {
      const owner = await dbGet("SELECT MayhemId, UserId FROM UserData WHERE UserAccessToken = ? LIMIT 1", [reqToken]);
      if (owner) {
        const ownerId = owner.MayhemId || owner.UserId;

        // Get accepted friends with land save paths in one query
        const friends = await dbAll(
          `SELECT f.friendMayhemId, u.LandSavePath FROM Friends f
           INNER JOIN UserData u ON u.MayhemId = f.friendMayhemId
           WHERE f.ownerMayhemId = ? AND f.status = 'accepted' LIMIT 50`,
          [ownerId]
        );

        if (friends?.length > 0) {
          // Parallelize land file reads for better performance
          const friendDataResults = await Promise.all(
            friends.map(async (friend) => {
              const friendData = await loadFriendDataFromLand(friend.LandSavePath);
              if (friendData) {
                return {
                  friendId: String(friend.friendMayhemId),
                  friendData,
                  authService: 0,
                };
              }
              return null;
            })
          );

          friendsToReturn = friendDataResults.filter(f => f !== null);
          
          if (friendsToReturn.length > 0) {
            logger.info({ count: friendsToReturn.length }, "Sending friends data to client (GET)");
          }
        }
      }
    }

    const message = GetFriendDataResponse.create({ friendData: friendsToReturn });
    res.type("application/x-protobuf");
    res.send(GetFriendDataResponse.encode(message).finish());
  } catch (error) {
    logger.error(error, "Error in friendData GET");
    next(error);
  }
});

// POST /bg_gameserver_plugin/friendData (without :service) - return user's own data on initial load
router.post(
  "/bg_gameserver_plugin/friendData",
  raw({ type: "application/x-protobuf", limit: "52428800" }),
  async (req, res, next) => {
    try {
      const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];
      
      if (!reqToken) {
        const response = GetFriendDataResponse.create({ friendData: [] });
        res.type("application/x-protobuf").send(GetFriendDataResponse.encode(response).finish());
        return;
      }

      const owner = await dbGet("SELECT MayhemId, UserId, LandSavePath FROM UserData WHERE UserAccessToken = ? LIMIT 1", [reqToken]);
      if (!owner) {
        const response = GetFriendDataResponse.create({ friendData: [] });
        res.type("application/x-protobuf").send(GetFriendDataResponse.encode(response).finish());
        return;
      }

      const ownerId = owner.MayhemId || owner.UserId;
      
      // Load and return user's own friend data from land file
      const friendData = await loadFriendDataFromLand(owner.LandSavePath);
      const friendDataPairs = [{
        friendId: String(ownerId),
        authService: 0,
      }];
      
      if (friendData) {
        friendDataPairs[0].friendData = friendData;
      }

      logger.info({ userId: ownerId }, "Sending user's own friendData to client (POST)");

      const response = GetFriendDataResponse.create({ friendData: friendDataPairs });
      res.type("application/x-protobuf").send(GetFriendDataResponse.encode(response).finish());
    } catch (error) {
      logger.error(error, "Error in POST friendData");
      next(error);
    }
  },
);

// POST /bg_gameserver_plugin/friendData/:service - send friend invites
router.post("/bg_gameserver_plugin/friendData/:service", async (req, res, next) => {
  try {
    const service = req.params.service;
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];
    
    if (!reqToken) {
      logger.warn("No token in POST friendData");
      res.status(401).json({ error: "No auth token" });
      return;
    }

    const owner = await dbGet("SELECT MayhemId, UserId FROM UserData WHERE UserAccessToken = ? LIMIT 1", [reqToken]);
    if (!owner) {
      logger.warn({ token: reqToken }, "Token not found for POST friendData");
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const fromId = owner.MayhemId || owner.UserId;
    const toId = req.body?.toId || req.body?.friendMayhemId || req.body?.targetId || req.body?.recipientId;

    if (!toId || !Number.isInteger(parseInt(toId))) {
      logger.warn({ body: req.body }, "Missing or invalid target friend ID");
      res.status(400).json({ error: "Missing or invalid target friend ID" });
      return;
    }

    const now = Math.floor(Date.now() / 1000);

    const existing = await dbGet(
      "SELECT status FROM Friends WHERE ownerMayhemId = ? AND friendMayhemId = ? LIMIT 1",
      [fromId, toId]
    );

    if (existing) {
      logger.info({ fromId, toId, status: existing.status }, "Friend request already exists");
      res.status(200).json({ success: true, status: existing.status });
      return;
    }

    await dbRun("INSERT INTO Friends (ownerMayhemId, friendMayhemId, status, createdAt) VALUES (?, ?, ?, ?)", [
      fromId,
      toId,
      "pending",
      now,
    ]);

    logger.info({ fromId, toId }, "Friend request created via POST");
    res.status(200).json({ success: true, status: "pending" });
  } catch (error) {
    logger.error(error, "Error handling POST friendData (invite)");
    res.status(500).json({ error: error.message });
  }
});

export default router;
