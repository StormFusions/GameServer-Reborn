/**
 * Session Manager - Tracks active player sessions in real-time
 * Monitors PlayerSession data and determines online status
 */

class SessionManager {
  constructor() {
    this.activeSessions = new Map(); // Map<userId, sessionData>
    this.sessionTimeout = 5 * 60 * 1000; // 5 minutes of inactivity = offline
    this.cleanupInterval = 60 * 1000; // Cleanup stale sessions every minute
    
    // Start periodic cleanup
    this.startCleanupTimer();
  }

  /**
   * Register or update a player session
   * @param {string} userId - The player's user ID
   * @param {string} mayhemId - The player's Mayhem ID
   * @param {string} hostname - Server hostname
   * @param {object} additionalData - Optional additional session data (can include username)
   */
  trackSession(userId, mayhemId, hostname, additionalData = {}) {
    if (!userId || !mayhemId) {
      return false;
    }

    const now = Date.now();
    const isNewSession = !this.activeSessions.has(userId);
    
    this.activeSessions.set(userId, {
      userId,
      mayhemId,
      hostname,
      lastActive: now,
      connectedAt: this.activeSessions.has(userId) 
        ? this.activeSessions.get(userId).connectedAt 
        : now,
      sessionId: this.activeSessions.has(userId)
        ? this.activeSessions.get(userId).sessionId
        : this._generateSessionId(),
      ...additionalData
    });

    if (global.logger) {
      global.logger.info(`Session ${isNewSession ? 'created' : 'updated'} for user ${userId} (${mayhemId}) on ${hostname}. Total active: ${this.activeSessions.size}`);
    }

    return true;
  }

  /**
   * Get a single player's session
   * @param {string} userId - The player's user ID
   * @returns {object|null} Session data or null if not found
   */
  getSession(userId) {
    const session = this.activeSessions.get(userId);
    
    if (session && !this._isSessionStale(session)) {
      return session;
    }
    
    // Remove stale session
    if (session) {
      this.activeSessions.delete(userId);
    }
    
    return null;
  }

  /**
   * Get all active sessions
   * @returns {array} Array of active session objects
   */
  getAllActiveSessions() {
    const now = Date.now();
    const active = [];
    
    for (const [userId, session] of this.activeSessions.entries()) {
      if (!this._isSessionStale(session)) {
        active.push({
          ...session,
          secondsActive: Math.floor((now - session.connectedAt) / 1000),
          lastActivitySeconds: Math.floor((now - session.lastActive) / 1000)
        });
      } else {
        this.activeSessions.delete(userId);
      }
    }
    
    return active.sort((a, b) => b.connectedAt - a.connectedAt);
  }

  /**
   * Get count of active players
   * @returns {number} Number of active sessions
   */
  getActivePlayerCount() {
    return this.getAllActiveSessions().length;
  }

  /**
   * Update last activity timestamp for a player
   * @param {string} userId - The player's user ID
   */
  updateActivity(userId) {
    const session = this.activeSessions.get(userId);
    if (session) {
      session.lastActive = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Track that a user is visiting a specific friend's land
   * @param {string} userId - The player's user ID
   * @param {string} visitingFriendId - The friend's Mayhem ID being visited
   */
  setVisitingFriend(userId, visitingFriendId) {
    const session = this.activeSessions.get(userId);
    if (session) {
      session.visitingFriendId = visitingFriendId;
      session.visitStartTime = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Get the friend ID that a user is currently visiting
   * @param {string} userId - The player's user ID
   * @returns {string|null} The friend's Mayhem ID or null if not visiting
   */
  getVisitingFriend(userId) {
    const session = this.activeSessions.get(userId);
    if (session && session.visitingFriendId) {
      return session.visitingFriendId;
    }
    return null;
  }

  /**
   * Clear the visiting friend context when done visiting
   * @param {string} userId - The player's user ID
   */
  clearVisitingFriend(userId) {
    const session = this.activeSessions.get(userId);
    if (session) {
      delete session.visitingFriendId;
      delete session.visitStartTime;
      return true;
    }
    return false;
  }

  /**
   * End a player's session
   * @param {string} userId - The player's user ID
   */
  endSession(userId) {
    return this.activeSessions.delete(userId);
  }

  /**
   * Clear all sessions (for server restart, etc.)
   */
  clearAllSessions() {
    this.activeSessions.clear();
  }

  /**
   * Get summary statistics
   * @returns {object} Session statistics
   */
  getStatistics() {
    const sessions = this.getAllActiveSessions();
    const now = Date.now();
    
    const uptimes = sessions.map(s => (now - s.connectedAt) / 1000);
    const avgUptime = uptimes.length > 0 
      ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length 
      : 0;

    const servers = {};
    sessions.forEach(s => {
      servers[s.hostname] = (servers[s.hostname] || 0) + 1;
    });

    return {
      totalActive: sessions.length,
      averageSessionLength: Math.floor(avgUptime),
      longestSession: Math.floor(Math.max(...uptimes, 0)),
      shortestSession: Math.floor(Math.min(...uptimes, 0)),
      serverDistribution: servers
    };
  }

  // ============ Private Methods ============

  /**
   * Check if a session has been inactive too long
   * @private
   */
  _isSessionStale(session) {
    return (Date.now() - session.lastActive) > this.sessionTimeout;
  }

  /**
   * Generate a unique session ID
   * @private
   */
  _generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Periodically clean up stale sessions
   * @private
   */
  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      let removed = 0;
      for (const [userId, session] of this.activeSessions.entries()) {
        if (this._isSessionStale(session)) {
          this.activeSessions.delete(userId);
          removed++;
        }
      }
      
      if (removed > 0) {
        global.logger?.debug(`SessionManager: Removed ${removed} stale sessions`);
      }
    }, this.cleanupInterval);

    // Allow Node to exit if this is the only timer running
    this.cleanupTimer.unref?.();
  }

  /**
   * Stop the cleanup timer (for testing/shutdown)
   * @private
   */
  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

// Export singleton instance
export default new SessionManager();
