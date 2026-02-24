import { dbGet, dbAll, dbRun } from "./db.js";
import { logger } from "./logger.js";
import fs from "fs";
import pb from "./protobuf.js";
import config from "../../config.json" with { type: "json" };

/**
 * Record a friend's visit to another player's land
 * @param {string} visitorMayhemId - The visiting friend's MayhemId
 * @param {string} landOwnerMayhemId - The land owner's MayhemId
 * @returns {Promise<void>}
 */
export async function recordFriendVisit(visitorMayhemId, landOwnerMayhemId) {
  try {
    const now = Math.floor(Date.now() / 1000);
    
    // Insert or update visit record
    await dbRun(
      `INSERT INTO FriendVisits (visitorMayhemId, landOwnerMayhemId, visitTime, actions)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(visitorMayhemId, landOwnerMayhemId) DO UPDATE SET visitTime = ?`,
      [visitorMayhemId, landOwnerMayhemId, now, now]
    );
    
    logger.debug(
      { visitor: visitorMayhemId, owner: landOwnerMayhemId },
      "Friend visit recorded"
    );
  } catch (error) {
    logger.error(
      { error, visitor: visitorMayhemId, owner: landOwnerMayhemId },
      "Error recording friend visit"
    );
  }
}

/**
 * Record a specific action a friend performed on another player's land
 * @param {string} visitorMayhemId - The friend performing the action
 * @param {string} visitorName - The friend's display name
 * @param {string} landOwnerMayhemId - The land owner's MayhemId
 * @param {number} buildingInstance - The building/character instance ID
 * @param {string} actionType - Type of action (tap, collect, steal, etc)
 * @param {boolean} isBuilding - Whether it's a building or character
 * @returns {Promise<void>}
 */
export async function recordFriendAction(
  visitorMayhemId,
  visitorName,
  landOwnerMayhemId,
  buildingInstance,
  actionType,
  isBuilding = true
) {
  try {
    const now = Math.floor(Date.now() / 1000);
    
    // Record the action
    await dbRun(
      `INSERT INTO FriendActions 
       (visitorMayhemId, visitorName, landOwnerMayhemId, buildingInstance, actionType, actionTime, isBuilding)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [visitorMayhemId, visitorName, landOwnerMayhemId, buildingInstance, actionType, now, isBuilding ? 1 : 0]
    );
    
    // Increment action count in FriendVisits
    await dbRun(
      `UPDATE FriendVisits 
       SET actions = actions + 1 
       WHERE visitorMayhemId = ? AND landOwnerMayhemId = ?`,
      [visitorMayhemId, landOwnerMayhemId]
    );
    
    logger.debug(
      { visitor: visitorMayhemId, owner: landOwnerMayhemId, action: actionType },
      "Friend action recorded"
    );
  } catch (error) {
    logger.error(
      { error, visitor: visitorMayhemId, owner: landOwnerMayhemId, action: actionType },
      "Error recording friend action"
    );
  }
}

/**
 * Get all visitors to a player's land for populating friendListData
 * @param {string} landOwnerMayhemId - The land owner's MayhemId
 * @param {number} maxResults - Maximum number of recent visitors to return (default: 50)
 * @returns {Promise<Array>} Array of friend visit records
 */
export async function getFriendVisitors(landOwnerMayhemId, maxResults = 50) {
  try {
    const visitors = await dbAll(
      `SELECT visitorMayhemId, visitTime, actions 
       FROM FriendVisits 
       WHERE landOwnerMayhemId = ? 
       ORDER BY visitTime DESC 
       LIMIT ?`,
      [landOwnerMayhemId, maxResults]
    );
    
    return visitors || [];
  } catch (error) {
    logger.error(
      { error, owner: landOwnerMayhemId },
      "Error getting friend visitors"
    );
    return [];
  }
}

/**
 * Get friend actions for a specific visitor to populate customFriendActionData
 * @param {string} visitorMayhemId - The visitor's MayhemId
 * @param {string} landOwnerMayhemId - The land owner's MayhemId
 * @param {number} maxResults - Maximum actions to return (default: 100)
 * @returns {Promise<Array>} Array of friend action records
 */
export async function getFriendActions(visitorMayhemId, landOwnerMayhemId, maxResults = 100) {
  try {
    const actions = await dbAll(
      `SELECT visitorName, buildingInstance, actionType, isBuilding, actionTime 
       FROM FriendActions 
       WHERE visitorMayhemId = ? AND landOwnerMayhemId = ? 
       ORDER BY actionTime DESC 
       LIMIT ?`,
      [visitorMayhemId, landOwnerMayhemId, maxResults]
    );
    
    return actions || [];
  } catch (error) {
    logger.error(
      { error, visitor: visitorMayhemId, owner: landOwnerMayhemId },
      "Error getting friend actions"
    );
    return [];
  }
}

/**
 * Get all friend actions on a land for populating customFriendActionData
 * @param {string} landOwnerMayhemId - The land owner's MayhemId
 * @param {number} maxResults - Maximum actions to return (default: 200)
 * @returns {Promise<Array>} Array of friend action records from all visitors
 */
export async function getAllLandFriendActions(landOwnerMayhemId, maxResults = 200) {
  try {
    const actions = await dbAll(
      `SELECT visitorName, buildingInstance, actionType, isBuilding, actionTime 
       FROM FriendActions 
       WHERE landOwnerMayhemId = ? 
       ORDER BY actionTime DESC 
       LIMIT ?`,
      [landOwnerMayhemId, maxResults]
    );
    
    return actions || [];
  } catch (error) {
    logger.error(
      { error, owner: landOwnerMayhemId },
      "Error getting all land friend actions"
    );
    return [];
  }
}

/**
 * Get summary of all friend actions on a land (for allFriendActionsCount proto field)
 * @param {string} landOwnerMayhemId - The land owner's MayhemId
 * @returns {Promise<Object>} Summary object with total count and last action time
 */
export async function getFriendActionsSummary(landOwnerMayhemId) {
  try {
    const summary = await dbGet(
      `SELECT 
        COUNT(*) as count, 
        MAX(actionTime) as lastActionTime,
        COUNT(DISTINCT visitorMayhemId) as uniqueVisitors
       FROM FriendActions 
       WHERE landOwnerMayhemId = ?`,
      [landOwnerMayhemId]
    );
    
    let totalActions = summary?.count || 0;
    let lastActionTime = summary?.lastActionTime || Math.floor(Date.now() / 1000);
    
    // ALSO check .events file for pending events (for backwards compatibility with old events)
    // Events are stored in .events file and also recorded in FriendActions when created
    // But old events may only be in the .events file, so we count them too
    try {
      const eventsFilePath = `${config.dataDirectory}/${landOwnerMayhemId}/${landOwnerMayhemId}.events`;
      if (fs.existsSync(eventsFilePath)) {
        const eventsData = fs.readFileSync(eventsFilePath);
        const EventsMessage = pb.lookupType("Data.EventsMessage");
        const eventsMessage = EventsMessage.decode(eventsData);
        
        if (eventsMessage.event && eventsMessage.event.length > 0) {
          // Use whichever is higher - database count or .events file count
          // This ensures we don't lose count if there's a discrepancy
          const eventsFileCount = eventsMessage.event.length;
          if (eventsFileCount > totalActions) {
            totalActions = eventsFileCount;
            logger.debug(
              { owner: landOwnerMayhemId, dbCount: summary?.count || 0, fileCount: eventsFileCount },
              "Events file has more events than database - using file count"
            );
          }
          
          // Update lastActionTime if .events file has a more recent event
          if (eventsMessage.event && eventsMessage.event.length > 0) {
            const lastEvent = eventsMessage.event[eventsMessage.event.length - 1];
            if (lastEvent.timestamp && lastEvent.timestamp > lastActionTime) {
              lastActionTime = lastEvent.timestamp;
            }
          }
        }
      }
    } catch (eventErr) {
      logger.warn(
        { err: eventErr, owner: landOwnerMayhemId },
        "Error checking .events file for count (using database count)"
      );
    }
    
    return {
      totalActions: totalActions,
      lastActionTime: lastActionTime,
      uniqueVisitors: summary?.uniqueVisitors || 0
    };
  } catch (error) {
    logger.error(
      { error, owner: landOwnerMayhemId },
      "Error getting friend actions summary"
    );
    return {
      totalActions: 0,
      lastActionTime: Math.floor(Date.now() / 1000),
      uniqueVisitors: 0
    };
  }
}

/**
 * Clear old friend visit history (older than specified days)
 * Useful for maintenance to prevent database from growing too large
 * @param {number} daysOld - Clear visits older than this many days (default: 30)
 * @returns {Promise<number>} Number of records deleted
 */
export async function clearOldFriendVisits(daysOld = 30) {
  try {
    const cutoffTime = Math.floor(Date.now() / 1000) - (daysOld * 24 * 60 * 60);
    
    const result = await dbRun(
      `DELETE FROM FriendVisits WHERE visitTime < ?`,
      [cutoffTime]
    );
    
    logger.info(
      { daysOld, deletedCount: result?.changes },
      "Cleaned up old friend visits"
    );
    
    return result?.changes || 0;
  } catch (error) {
    logger.error(
      { error, daysOld },
      "Error clearing old friend visits"
    );
    return 0;
  }
}

/**
 * Clear old friend actions (older than specified days)
 * @param {number} daysOld - Clear actions older than this many days (default: 30)
 * @returns {Promise<number>} Number of records deleted
 */
export async function clearOldFriendActions(daysOld = 30) {
  try {
    const cutoffTime = Math.floor(Date.now() / 1000) - (daysOld * 24 * 60 * 60);
    
    const result = await dbRun(
      `DELETE FROM FriendActions WHERE actionTime < ?`,
      [cutoffTime]
    );
    
    logger.info(
      { daysOld, deletedCount: result?.changes },
      "Cleaned up old friend actions"
    );
    
    return result?.changes || 0;
  } catch (error) {
    logger.error(
      { error, daysOld },
      "Error clearing old friend actions"
    );
    return 0;
  }
}
