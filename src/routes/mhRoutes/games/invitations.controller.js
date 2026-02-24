import { Router } from "express";
import { dbGet, dbAll, dbRun } from "../../../lib/db.js";
import { logger } from "../../../lib/logger.js";

const router = Router();

// Helper to get user by MayhemId or UserId
const getUserByIdParam = async (idParam) => {
  return await dbGet(
    "SELECT MayhemId, UserId FROM UserData WHERE MayhemId = ? OR UserId = ? LIMIT 1",
    [idParam, idParam]
  );
};

// Helper to format invitation entries
const formatInvitationEntry = (user, createdAt) => ({
  timestamp: (createdAt * 1000) * 1000,
  userId: user.MayhemId,
  dateTime: new Date(createdAt * 1000).toISOString(),
  inviteTags: { invite_surface: "unknown" },
  userType: "NUCLEUS_USER",
  displayName: user.UserName,
  personaId: user.MayhemId,
  nickName: user.UserName
});

// ===== SPRINGFIELD API ENDPOINTS =====

// GET /:userId/invitations/inbound
// Returns pending friend invitations received
router.get("/:userId/invitations/inbound", async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await getUserByIdParam(userId);
    if (!user) {
      return res.json({ entries: [], pagingInfo: { size: 0, offset: 0, totalSize: 0 } });
    }

    const rows = await dbAll(
      `SELECT u.MayhemId, u.UserId, u.UserName, f.createdAt FROM UserData u
       INNER JOIN Friends f ON u.MayhemId = f.ownerMayhemId
       WHERE f.friendMayhemId = ? AND f.status = 'pending'
       ORDER BY f.createdAt DESC`,
      [user.MayhemId]
    );

    const entries = (rows || []).map(u => formatInvitationEntry(u, u.createdAt));
    res.json({ entries, pagingInfo: { size: entries.length, offset: 0, totalSize: entries.length } });
  } catch (error) {
    logger.error(error, "Error getting inbound invitations");
    res.json({ entries: [], pagingInfo: { size: 0, offset: 0, totalSize: 0 } });
  }
});

// GET /:userId/invitations/outbound
// Returns pending friend invitations sent
router.get("/:userId/invitations/outbound", async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await getUserByIdParam(userId);
    if (!user) {
      return res.json({ entries: [], pagingInfo: { size: 0, offset: 0, totalSize: 0 } });
    }

    const rows = await dbAll(
      `SELECT u.MayhemId, u.UserId, u.UserName, f.createdAt FROM UserData u
       INNER JOIN Friends f ON u.MayhemId = f.friendMayhemId
       WHERE f.ownerMayhemId = ? AND f.status = 'pending'
       ORDER BY f.createdAt DESC`,
      [user.MayhemId]
    );

    const entries = (rows || []).map(u => formatInvitationEntry(u, u.createdAt));
    res.json({ entries, pagingInfo: { size: entries.length, offset: 0, totalSize: entries.length } });
  } catch (error) {
    logger.error(error, "Error getting outbound invitations");
    res.json({ entries: [], pagingInfo: { size: 0, offset: 0, totalSize: 0 } });
  }
});

// POST /:userId/invitations/outbound/:toUserId
// Send friend invitation - returns 204 No Content
router.post("/:userId/invitations/outbound/:toUserId", async (req, res) => {
  try {
    const fromUserId = req.params.userId;
    const toUserIdParam = req.params.toUserId;

    const fromUser = await getUserByIdParam(fromUserId);
    const toUser = await getUserByIdParam(toUserIdParam);

    if (!fromUser || !toUser) {
      return res.status(204).send();
    }

    const existing = await dbGet(
      "SELECT status FROM Friends WHERE (ownerMayhemId = ? AND friendMayhemId = ?) OR (ownerMayhemId = ? AND friendMayhemId = ?)",
      [fromUser.MayhemId, toUser.MayhemId, toUser.MayhemId, fromUser.MayhemId]
    );

    if (existing) {
      return res.status(204).send();
    }

    const now = Math.floor(Date.now() / 1000);
    await dbRun(
      "INSERT INTO Friends (ownerMayhemId, friendMayhemId, status, createdAt) VALUES (?, ?, ?, ?)",
      [fromUser.MayhemId, toUser.MayhemId, "pending", now]
    );

    res.status(204).send();
  } catch (error) {
    logger.error(error, "Error sending friend invitation");
    res.status(204).send();
  }
});

// POST /:userId/invitations/inbound/:fromUserId
// Accept friend invitation - returns 204 No Content
router.post("/:userId/invitations/inbound/:fromUserId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const fromUserIdParam = req.params.fromUserId;

    const user = await getUserByIdParam(userId);
    const fromUser = await getUserByIdParam(fromUserIdParam);

    if (!user || !fromUser) {
      return res.status(204).send();
    }

    // Update original invitation to accepted
    const result = await dbRun(
      "UPDATE Friends SET status = ? WHERE ownerMayhemId = ? AND friendMayhemId = ? AND status = ?",
      ["accepted", fromUser.MayhemId, user.MayhemId, "pending"]
    );

    if (!result || result.changes === 0) {
      return res.status(204).send();
    }

    // Create reciprocal friendship
    const now = Math.floor(Date.now() / 1000);
    await dbRun(
      "INSERT OR IGNORE INTO Friends (ownerMayhemId, friendMayhemId, status, createdAt) VALUES (?, ?, ?, ?)",
      [user.MayhemId, fromUser.MayhemId, "accepted", now]
    );

    res.status(204).send();
  } catch (error) {
    logger.error(error, "Error accepting friend invitation");
    res.status(204).send();
  }
});

// ===== LEGACY ENDPOINTS (Deprecated - kept for backward compatibility) =====

// POST invitations/inbound - LEGACY
router.post("/invitations/inbound", async (req, res) => {
  try {
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];
    if (!reqToken) return res.status(401).json({ error: "No auth token" });

    const owner = await dbGet("SELECT MayhemId FROM UserData WHERE UserAccessToken = ?", [reqToken]);
    if (!owner) return res.status(401).json({ error: "Invalid token" });

    const rows = await dbAll(
      `SELECT u.MayhemId, u.UserId, u.UserName, f.createdAt FROM UserData u
       INNER JOIN Friends f ON u.MayhemId = f.ownerMayhemId
       WHERE f.friendMayhemId = ? AND f.status = 'pending'
       ORDER BY f.createdAt DESC`,
      [owner.MayhemId]
    );

    const entries = (rows || []).map(u => formatInvitationEntry(u, u.createdAt));
    res.json({ entries, pagingInfo: { size: entries.length, offset: 0, totalSize: entries.length } });
  } catch (error) {
    logger.error(error, "Error getting inbound invitations");
    res.status(500).json({ error: error.message });
  }
});

// POST invitations/outbound - LEGACY
router.post("/invitations/outbound", async (req, res) => {
  try {
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];
    if (!reqToken) return res.status(401).json({ error: "No auth token" });

    const owner = await dbGet("SELECT MayhemId FROM UserData WHERE UserAccessToken = ?", [reqToken]);
    if (!owner) return res.status(401).json({ error: "Invalid token" });

    const rows = await dbAll(
      `SELECT u.MayhemId, u.UserId, u.UserName, f.createdAt FROM UserData u
       INNER JOIN Friends f ON u.MayhemId = f.friendMayhemId
       WHERE f.ownerMayhemId = ? AND f.status = 'pending'
       ORDER BY f.createdAt DESC`,
      [owner.MayhemId]
    );

    const entries = (rows || []).map(u => formatInvitationEntry(u, u.createdAt));
    res.json({ entries, pagingInfo: { size: entries.length, offset: 0, totalSize: entries.length } });
  } catch (error) {
    logger.error(error, "Error getting outbound invitations");
    res.status(500).json({ error: error.message });
  }
});

// POST friend/invite - LEGACY - send friend invitation
router.post("/friend/invite", async (req, res) => {
  try {
    const { fromId, toId } = req.body;
    if (!fromId || !toId) {
      return res.status(400).json({ error: "Missing fromId or toId" });
    }

    const existing = await dbGet(
      "SELECT status FROM Friends WHERE ownerMayhemId = ? AND friendMayhemId = ?",
      [fromId, toId]
    );

    if (existing) {
      return res.status(409).json({ error: "Friend request already exists", status: existing.status });
    }

    const now = Math.floor(Date.now() / 1000);
    await dbRun(
      "INSERT INTO Friends (ownerMayhemId, friendMayhemId, status, createdAt) VALUES (?, ?, ?, ?)",
      [fromId, toId, "pending", now]
    );

    res.json({ success: true, status: "pending" });
  } catch (error) {
    logger.error(error, "Error sending friend invite");
    res.status(500).json({ error: error.message });
  }
});

// POST friend/accept - LEGACY
router.post("/friend/accept", async (req, res) => {
  try {
    const { fromId, acceptorId } = req.body;
    if (!fromId || !acceptorId) {
      return res.status(400).json({ error: "Missing fromId or acceptorId" });
    }

    const info = await dbRun(
      "UPDATE Friends SET status = ? WHERE ownerMayhemId = ? AND friendMayhemId = ? AND status = ?",
      ["accepted", fromId, acceptorId, "pending"]
    );

    if (!info || info.changes === 0) {
      return res.status(404).json({ error: "Friend request not found" });
    }

    res.json({ success: true, status: "accepted" });
  } catch (error) {
    logger.error(error, "Error accepting friend request");
    res.status(500).json({ error: error.message });
  }
});

// POST friend/decline - LEGACY
router.post("/friend/decline", async (req, res) => {
  try {
    const { fromId, declinerId } = req.body;
    if (!fromId || !declinerId) {
      return res.status(400).json({ error: "Missing fromId or declinerId" });
    }

    const info = await dbRun(
      "DELETE FROM Friends WHERE ownerMayhemId = ? AND friendMayhemId = ? AND status = ?",
      [fromId, declinerId, "pending"]
    );

    if (!info || info.changes === 0) {
      return res.status(404).json({ error: "Friend request not found" });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error(error, "Error declining friend request");
    res.status(500).json({ error: error.message });
  }
});

// DELETE /:userId/friends/:friendId
// Removes an accepted friend (Origin Friends feature)
router.delete("/:userId/friends/:friendId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const friendId = req.params.friendId;

    const user = await getUserByIdParam(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Delete bidirectional friendship
    const info = await dbRun(
      "DELETE FROM Friends WHERE (ownerMayhemId = ? AND friendMayhemId = ?) OR (ownerMayhemId = ? AND friendMayhemId = ?) AND status = 'accepted'",
      [user.MayhemId, friendId, friendId, user.MayhemId]
    );

    if (!info || info.changes === 0) {
      return res.status(404).json({ error: "Friend relationship not found" });
    }

    // Return 204 No Content
    res.status(204).send();
  } catch (error) {
    logger.error(error, "Error removing friend");
    res.status(500).json({ error: error.message });
  }
});

// POST friend/remove - LEGACY
router.post("/friend/remove", async (req, res) => {
  try {
    const { fromId, toId } = req.body;
    if (!fromId || !toId) {
      return res.status(400).json({ error: "Missing fromId or toId" });
    }

    const info = await dbRun(
      "DELETE FROM Friends WHERE ownerMayhemId = ? AND friendMayhemId = ? AND status = ?",
      [fromId, toId, "accepted"]
    );

    if (!info || info.changes === 0) {
      return res.status(404).json({ error: "Friend relationship not found" });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error(error, "Error removing friend");
    res.status(500).json({ error: error.message });
  }
});

// ===== ROUTE ALIASES FOR /2/USERS PREFIX =====
// When mounted at /friends, add /2/users prefixed routes to match /friends/2/users/* paths

// GET /2/users/:userId/invitations/inbound (duplicate handler for /friends mount)
router.get("/2/users/:userId/invitations/inbound", async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await getUserByIdParam(userId);
    if (!user) {
      return res.json({ entries: [], pagingInfo: { size: 0, offset: 0, totalSize: 0 } });
    }

    const rows = await dbAll(
      `SELECT u.MayhemId, u.UserId, u.UserName, f.createdAt FROM UserData u
       INNER JOIN Friends f ON u.MayhemId = f.ownerMayhemId
       WHERE f.friendMayhemId = ? AND f.status = 'pending'
       ORDER BY f.createdAt DESC`,
      [user.MayhemId]
    );

    const entries = (rows || []).map(u => formatInvitationEntry(u, u.createdAt));
    res.json({ entries, pagingInfo: { size: entries.length, offset: 0, totalSize: entries.length } });
  } catch (error) {
    logger.error(error, "Error getting inbound invitations");
    res.json({ entries: [], pagingInfo: { size: 0, offset: 0, totalSize: 0 } });
  }
});

// GET /2/users/:userId/invitations/outbound (duplicate handler for /friends mount)
router.get("/2/users/:userId/invitations/outbound", async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await getUserByIdParam(userId);
    if (!user) {
      return res.json({ entries: [], pagingInfo: { size: 0, offset: 0, totalSize: 0 } });
    }

    const rows = await dbAll(
      `SELECT u.MayhemId, u.UserId, u.UserName, f.createdAt FROM UserData u
       INNER JOIN Friends f ON u.MayhemId = f.friendMayhemId
       WHERE f.ownerMayhemId = ? AND f.status = 'pending'
       ORDER BY f.createdAt DESC`,
      [user.MayhemId]
    );

    const entries = (rows || []).map(u => formatInvitationEntry(u, u.createdAt));
    res.json({ entries, pagingInfo: { size: entries.length, offset: 0, totalSize: entries.length } });
  } catch (error) {
    logger.error(error, "Error getting outbound invitations");
    res.json({ entries: [], pagingInfo: { size: 0, offset: 0, totalSize: 0 } });
  }
});

// POST /2/users/:userId/invitations/outbound/:toUserId (duplicate handler for /friends mount)
router.post("/2/users/:userId/invitations/outbound/:toUserId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const toUserIdParam = req.params.toUserId;

    const user = await getUserByIdParam(userId);
    const toUser = await getUserByIdParam(toUserIdParam);

    if (!user || !toUser) {
      return res.status(204).send();
    }

    await dbRun(
      "INSERT OR IGNORE INTO Friends (ownerMayhemId, friendMayhemId, status, createdAt) VALUES (?, ?, ?, ?)",
      [user.MayhemId, toUser.MayhemId, "pending", Math.floor(Date.now() / 1000)]
    );

    res.status(204).send();
  } catch (error) {
    logger.error(error, "Error sending friend invitation");
    res.status(204).send();
  }
});

// POST /2/users/:userId/invitations/inbound/:fromUserId (duplicate handler for /friends mount)
router.post("/2/users/:userId/invitations/inbound/:fromUserId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const fromUserIdParam = req.params.fromUserId;

    const user = await getUserByIdParam(userId);
    const fromUser = await getUserByIdParam(fromUserIdParam);

    if (!user || !fromUser) {
      return res.status(204).send();
    }

    const result = await dbRun(
      "UPDATE Friends SET status = ? WHERE ownerMayhemId = ? AND friendMayhemId = ? AND status = ?",
      ["accepted", fromUser.MayhemId, user.MayhemId, "pending"]
    );

    if (!result || result.changes === 0) {
      return res.status(204).send();
    }

    const now = Math.floor(Date.now() / 1000);
    await dbRun(
      "INSERT OR IGNORE INTO Friends (ownerMayhemId, friendMayhemId, status, createdAt) VALUES (?, ?, ?, ?)",
      [user.MayhemId, fromUser.MayhemId, "accepted", now]
    );

    res.status(204).send();
  } catch (error) {
    logger.error(error, "Error accepting friend invitation");
    res.status(204).send();
  }
});

// DELETE /2/users/:userId/friends/:friendId (duplicate handler for /friends mount)
router.delete("/2/users/:userId/friends/:friendId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const friendId = req.params.friendId;

    const user = await getUserByIdParam(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const friend = await getUserByIdParam(friendId);
    if (!friend) {
      return res.status(404).json({ error: "Friend not found" });
    }

    // Delete bidirectional relationship
    await dbRun(
      "DELETE FROM Friends WHERE (ownerMayhemId = ? AND friendMayhemId = ?) OR (ownerMayhemId = ? AND friendMayhemId = ?)",
      [user.MayhemId, friend.MayhemId, friend.MayhemId, user.MayhemId]
    );

    res.status(204).send();
  } catch (error) {
    logger.error(error, "Error deleting friend");
    res.status(404).send();
  }
});

export default router;
