// Format a millisecond epoch into a friendly local string with timezone.
function formatTimestamp(ms) {
  try {
    const d = new Date(Number(ms));
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });
  } catch (err) {
    return new Date(ms).toISOString();
  }
}
window.formatTimestamp = formatTimestamp;

class Api {
  constructor() {
    this.intervalIds = []; // Store interval IDs for cleanup
  }

  async initialize() {
    try {
      // Clean up any existing intervals first
      this.cleanup();

      this.setupEventListeners();

      this.getStatistics();
      this.intervalIds.push(setInterval(() => this.getStatistics(), 60000));

      this.getEvent();

      this.getAccountInfo();
      this.getConfig();

      // Fetch active player count
      this.updatePlayerCount();
      this.intervalIds.push(setInterval(() => this.updatePlayerCount(), 5000));

      this.usersCurrentPage = 1;
      this.lastUserResponseCount = 0;
      this.usersPagesize = 10;
      this.usersCurrentQuery = "";
      this.loadUsers();

      this.savefilesCurrentPage = 1;
      this.lastSavefileResponseCount = 0;
      this.savefilesPagesize = 10;
      this.savefilesCurrentQuery = "";
      this.loadSavefiles();

      // Load friends lists on initialization
      this.loadFriendsLists();
      // Refresh every 30 seconds
      this.intervalIds.push(setInterval(() => this.loadFriendsLists(), 30000));
    } catch (error) {
      console.error("Error initializing dashboard:", error);
    }
  }

  cleanup() {
    // Clear all stored intervals to prevent memory leaks
    this.intervalIds.forEach(id => clearInterval(id));
    this.intervalIds = [];
  }

  setupEventListeners() {
    if (document.getElementById("user-town-form")) {
      document.getElementById("user-town-form").addEventListener("submit", async (e) => {
        e.preventDefault();

        const formData = new FormData();
        const townInput = document.getElementById("town-input");
        formData.append("town", townInput.files[0]);

        const response = await fetch('/userdash/api/uploadTown', {
          method: 'POST',
          body: formData
        });
      });
    }
  }

  async updatePlayerCount() {
    try {
      const element = document.querySelector('.current-users');
      if (!element) return;

      const response = await fetch('/dashboard/api/players/count');
      const data = await response.json();
      
      if (data.success && data.data !== undefined) {
        element.textContent = `Current Players: ${data.data}`;
      }
    } catch (error) {
      console.error("Error fetching player count:", error);
    }
  }

  async usersDownloadFile() {
    const link = document.createElement('a');
    link.href = "/userdash/api/exportTown";
    //link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }


  async getAccountInfo() {
    try {
      if (document.getElementById("username-input") && document.getElementById("email-input")) {
        await fetch("/userdash/api/getAccountInfo", {
          method: "GET",
        })
          .then((response) => response.json())
          .then((response) => {
            const usernameElement = document.getElementById("username-input")
            const emailElement = document.getElementById("email-input");

            usernameElement.value = response.username;
            emailElement.value = response.email;
          });
      }
    } catch (error) {
      console.error(error);
    }
  }

  async changeUsername() {
    try {
      const usernameInput = document.getElementById("username-input");

      await fetch("/userdash/api/changeUsername", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: usernameInput.value }),
      });

    } catch (error) {
      console.error(error);
    }
  }

  async changeEmail() {
    try {
      const emailInput = document.getElementById("email-input");

      await fetch("/userdash/api/changeEmail", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: emailInput.value }),
      });

    } catch (error) {
      console.error(error);
    }
  }

  async areYouSure() {
    try {
      const deleteButton = document.getElementById("delete-button");
      deleteButton.innerHTML = "Are you sure?";
      deleteButton.onclick = this.deleteAccount;

    } catch (error) {
      console.error(error);
    }
  }

  async deleteAccount() {
    try {
      await fetch("/userdash/api/deleteAccount", {
        method: "POST"
      })
      .then(async response => {
        if (response.ok) {
          window.location.reload();
        }
      });

    } catch (error) {
      console.error(error);
    }
  }

  async logout() {
    try {
      await fetch("/userdash/api/logout", {
        method: "POST"
      })
      .then(async response => {
        if (response.ok) {
          window.location.reload();
        }
      });

    } catch (error) {
      console.error(error);
    }
  }

  // -- Friends System -- //

  async searchUser() {
    try {
      const username = document.getElementById("search-username-input").value;
      if (!username.trim()) {
        alert("Please enter a username");
        return;
      }

      const response = await fetch("/userdash/api/friends/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username })
      });

      const data = await response.json();
      const resultDiv = document.getElementById("search-result");

      if (!data.found) {
        resultDiv.innerHTML = `<p style="color: #ff6b6b;">User not found</p>`;
        return;
      }

      const status = data.relationshipStatus;
      let actionButton = "";

      if (status === "none") {
        actionButton = `
          <button class="friend-action-btn add" onclick="API.sendFriendRequest('${data.user.mayhemId}')" title="Send Friend Request">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </button>
        `;
      } else if (status === "pending") {
        actionButton = `<button class="friend-action-btn" disabled title="Request Sent" style="background-color: #666; cursor: not-allowed;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        </button>`;
      } else if (status === "accepted") {
        actionButton = `
          <button class="friend-action-btn remove" onclick="API.removeFriend('${data.user.mayhemId}')" title="Remove Friend">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-9l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        `;
      }

      resultDiv.innerHTML = `
        <div style="padding: 1rem; background: #0d0d0d; border: 1px solid #333; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
          <div>
            <strong style="color: #51cf66; font-size: 1.05rem;">${data.user.username}</strong> <span style="color: #999;">(ID: ${data.user.userId})</span>
          </div>
          ${actionButton}
        </div>
      `;
    } catch (error) {
      console.error("Error searching user:", error);
      alert("Error searching user: " + error.message);
    }
  }

  async sendFriendRequest(targetMayhemId) {
    try {
      const response = await fetch("/userdash/api/friends/send-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMayhemId })
      });

      const data = await response.json();
      if (data.success) {
        alert("Friend request sent!");
        this.loadFriendsLists();
        this.searchUser(); // Refresh search result
      } else {
        alert("Error: " + data.message);
      }
    } catch (error) {
      console.error("Error sending friend request:", error);
      alert("Error sending friend request: " + error.message);
    }
  }

  async acceptFriendRequest(fromMayhemId) {
    try {
      const response = await fetch("/userdash/api/friends/accept-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromMayhemId })
      });

      const data = await response.json();
      if (data.success) {
        this.loadFriendsLists();
      } else {
        alert("Error: " + data.message);
      }
    } catch (error) {
      console.error("Error accepting friend request:", error);
    }
  }

  async rejectFriendRequest(fromMayhemId) {
    try {
      const response = await fetch("/userdash/api/friends/reject-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromMayhemId })
      });

      const data = await response.json();
      if (data.success) {
        this.loadFriendsLists();
      } else {
        alert("Error: " + data.message);
      }
    } catch (error) {
      console.error("Error rejecting friend request:", error);
    }
  }

  async removeFriend(friendMayhemId) {
    if (!confirm("Are you sure you want to remove this friend?")) {
      return;
    }

    try {
      const response = await fetch("/userdash/api/friends/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendMayhemId })
      });

      const data = await response.json();
      if (data.success) {
        alert("Friend removed");
        this.loadFriendsLists();
        // Only refresh search result if there's actually a search query
        const searchInput = document.getElementById("search-username-input");
        if (searchInput && searchInput.value.trim()) {
          this.searchUser();
        }
      } else {
        alert("Error: " + data.message);
      }
    } catch (error) {
      console.error("Error removing friend:", error);
      alert("Error removing friend: " + error.message);
    }
  }

  async loadFriendsLists() {
    try {
      // Load pending sent requests
      const sentRes = await fetch("/userdash/api/friends/pending-sent", { method: "GET" });
      const sentData = await sentRes.json();
      const sentList = document.getElementById("pending-sent-list");
      const sentCount = document.getElementById("pending-sent-count");
      if (sentList) {
        if (sentData.pending.length === 0) {
          sentList.innerHTML = '<p class="empty-message">Awaiting acceptance...</p>';
        } else {
          sentList.innerHTML = sentData.pending.map(p => `
            <div class="friend-item">
              <div class="friend-info">
                <div class="friend-username">${p.username}</div>
                <div class="friend-id">${p.mayhemId}</div>
              </div>
              <div class="friend-actions">
                <button class="friend-action-btn remove" onclick="API.cancelFriendRequest('${p.mayhemId}')" title="Cancel Request">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-9l-1 1H5v2h14V4z"/>
                  </svg>
                </button>
              </div>
            </div>
          `).join("");
        }
        if (sentCount) sentCount.textContent = sentData.pending.length;
      }

      // Load pending received requests
      const receivedRes = await fetch("/userdash/api/friends/pending-received", { method: "GET" });
      const receivedData = await receivedRes.json();
      const receivedList = document.getElementById("pending-received-list");
      const receivedCount = document.getElementById("pending-received-count");
      if (receivedList) {
        if (receivedData.pending.length === 0) {
          receivedList.innerHTML = '<p class="empty-message">No incoming requests</p>';
        } else {
          receivedList.innerHTML = receivedData.pending.map(p => `
            <div class="friend-item">
              <div class="friend-info">
                <div class="friend-username">${p.username}</div>
                <div class="friend-id">${p.mayhemId}</div>
              </div>
              <div class="friend-actions">
                <button class="friend-action-btn accept" onclick="API.acceptFriendRequest('${p.mayhemId}')" title="Accept Request">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                </button>
                <button class="friend-action-btn reject" onclick="API.rejectFriendRequest('${p.mayhemId}')" title="Reject Request">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
            </div>
          `).join("");
        }
        if (receivedCount) receivedCount.textContent = receivedData.pending.length;
      }

      // Load friends list
      const friendsRes = await fetch("/userdash/api/friends/list", { method: "GET" });
      const friendsData = await friendsRes.json();
      const friendsList = document.getElementById("friends-list");
      const friendsCount = document.getElementById("friends-count");
      if (friendsList) {
        if (friendsData.friends.length === 0) {
          friendsList.innerHTML = '<p class="empty-message">Start adding friends!</p>';
        } else {
          friendsList.innerHTML = friendsData.friends.map(f => {
            const lastPlayedText = f.lastActive 
              ? new Date(f.lastActive).toLocaleString(undefined, {
                  year: 'numeric',
                  month: 'short', 
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : 'Never';
            return `
            <div class="friend-item">
              <div class="friend-info">
                <div class="friend-username">${f.username}</div>
                <div class="friend-id">${f.mayhemId}</div>
                <div class="friend-last-played">Last played: ${lastPlayedText}</div>
              </div>
              <div class="friend-actions">
                <button class="friend-action-btn remove" onclick="API.removeFriend('${f.mayhemId}')" title="Remove Friend">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-9l-1 1H5v2h14V4z"/>
                  </svg>
                </button>
              </div>
            </div>
            `;
          }).join("");
        }
        if (friendsCount) friendsCount.textContent = friendsData.friends.length;
      }
    } catch (error) {
      console.error("Error loading friends lists:", error);
    }
  }

  async cancelFriendRequest(toMayhemId) {
    try {
      const response = await fetch("/userdash/api/friends/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendMayhemId: toMayhemId })
      });

      const data = await response.json();
      if (data.success) {
        this.loadFriendsLists();
      }
    } catch (error) {
      console.error("Error canceling friend request:", error);
    }
  }

  async getStatistics() {
    try {
      if (document.getElementById("status-div")) {
        await fetch("/dashboard/api/general/statistics", {
          method: "GET",
        })
          .then((response) => response.json())
          .then((response) => {
            const statusElement = document.getElementById("status-div");
            const uptimeElement = document.getElementById("uptime-div");
            const usersElement = document.getElementById("users-div");

            statusElement.textContent = response.status;
            uptimeElement.textContent = `${Math.floor(response.uptime / 3600)} hours and ${Math.floor(response.uptime / 60) % 60} minutes`;
            usersElement.textContent = response.connectedUsers;
          });
      }
    } catch (error) {
      console.error(error);
    }
  }

  async getEvent() {
    if (!document.getElementById("event-div")) {
      return;
    }

    try {
      await fetch("/dashboard/api/event/get", {
        method: "GET",
      })
        .then((response) => response.json())
        .then(async (response) => {
          const eventElement = document.getElementById("event-div");
          const gameTimeEl = document.getElementById("game-time-div");

          // Fetch current lobby/game time from the game routes
          try {
            const tResp = await fetch('/mh/games/lobby/time');
            const xml = await tResp.text();
            const m = xml.match(/<epochMilliseconds>(\d+)<\/epochMilliseconds>/);
            if (m && m[1]) {
              const ms = Number(m[1]);
              if (gameTimeEl) gameTimeEl.textContent = formatTimestamp(ms);
            } else {
              if (gameTimeEl) gameTimeEl.textContent = 'Unknown';
            }
          } catch (err) {
            console.error('Error fetching lobby time:', err);
            if (gameTimeEl) gameTimeEl.textContent = 'Error';
          }

          await fetch("/dashboard/assets/events.json")
            .then((response) => response.json())
            .then((data) => {
              let eventName = "Now";

              // Prefer server-resolved name when available
              if (response.eventName) {
                eventName = response.eventName + (response.lobbyTime && response.lobbyTime != 0 );
              } else if (response.lobbyTime && response.lobbyTime != 0) {
                // events.json timestamps are in seconds; server may return milliseconds
                const lobbySeconds = response.lobbyTime > 1e11 ? Math.floor(response.lobbyTime / 1000) : response.lobbyTime;
                const event = Object.values(data)
                  .flat()
                  .find((e) => Number(e.timestamp) === Number(lobbySeconds));
                eventName = event
                  ? event.name + " (server time overridden)"
                  : `No event found for the current timestamp: ${response.lobbyTime}`;
              }

              if (eventElement) eventElement.textContent = eventName;
            });
        });
    } catch (error) {
      console.error(error);
    }
  }

  async getConfig() {
    try {
      // populate form fields
      if (!document.getElementById("config-form")) return;

      await fetch("/dashboard/api/config/get", {
        method: "GET",
      })
        .then((response) => response.json())
        .then((cfg) => {
          const set = (id, value) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.type === "checkbox") el.checked = Boolean(value);
            else el.value = value === undefined || value === null ? "" : value;
          };

          set("cfg-verbose", cfg.verbose);
          set("cfg-ip", cfg.ip);
          set("cfg-listenPort", cfg.listenPort);
          set("cfg-dataDirectory", cfg.dataDirectory);
          set("cfg-startingDonuts", cfg.startingDonuts);
          set("cfg-startingUID", cfg.startingUID);
          set("cfg-startingMID", cfg.startingMID);
          set("cfg-adminKey", cfg.adminKey);
          set("cfg-useTSTO_API", cfg.useTSTO_API);
          set("cfg-TSTO_APIkey", cfg.TSTO_APIkey);
          set("cfg-TSTO_APIteam", cfg.TSTO_APIteam);
          set("cfg-useSMTP", cfg.useSMTP);
          set("cfg-SMTPhost", cfg.SMTPhost);
          set("cfg-SMTPport", cfg.SMTPport);
          set("cfg-SMTPsecure", cfg.SMTPsecure);
          set("cfg-SMTPuser", cfg.SMTPuser);
          set("cfg-SMTPpass", cfg.SMTPpass);
          set("cfg-serveDlcsLocally", cfg.serveDlcsLocally);
          set("cfg-localDlcFolder", cfg.localDlcFolder);
          set("cfg-backupDirectory", cfg.backupDirectory);
          set("cfg-backupInterval", cfg.backupInterval);
          set("cfg-maxBackups", cfg.maxBackups);
        });
    } catch (error) {
      console.error(error);
    }
  }

  async saveConfig() {
    try {
      const form = document.getElementById("config-form");
      if (!form) return;

      const get = (id) => {
        const el = document.getElementById(id);
        if (!el) return undefined;
        if (el.type === "checkbox") return el.checked;
        if (el.type === "number") return Number(el.value);
        return el.value;
      };

      const payload = {
        verbose: get("cfg-verbose"),
        ip: get("cfg-ip"),
        listenPort: Number(get("cfg-listenPort")),
        dataDirectory: get("cfg-dataDirectory"),
        startingDonuts: Number(get("cfg-startingDonuts")),
        startingUID: get("cfg-startingUID"),
        startingMID: get("cfg-startingMID"),
        adminKey: get("cfg-adminKey"),
        // adminKey is read-only - don't send it back to be changed
        useTSTO_API: get("cfg-useTSTO_API"),
        TSTO_APIkey: get("cfg-TSTO_APIkey"),
        TSTO_APIteam: get("cfg-TSTO_APIteam"),
        useSMTP: get("cfg-useSMTP"),
        SMTPhost: get("cfg-SMTPhost"),
        SMTPport: Number(get("cfg-SMTPport")),
        SMTPsecure: get("cfg-SMTPsecure"),
        SMTPuser: get("cfg-SMTPuser"),
        SMTPpass: get("cfg-SMTPpass"),
        serveDlcsLocally: get("cfg-serveDlcsLocally"),
        localDlcFolder: get("cfg-localDlcFolder"),
        backupDirectory: get("cfg-backupDirectory"),
        backupInterval: Number(get("cfg-backupInterval")),
        maxBackups: Number(get("cfg-maxBackups")),
      };

      await fetch("/dashboard/api/config/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async (response) => {
        if (response.ok) {
          alert("Config updated. Some changes may require a server restart to take effect.");
          this.getConfig();
        } else {
          alert("Failed to update config: " + (await response.text()));
        }
      });
    } catch (error) {
      console.error(error);
    }
  }

  togglePasswordVisibility() {
    console.warn("togglePasswordVisibility is deprecated; use toggleVisibility(targetId, btnId) instead");
  }

  toggleVisibility(targetId, btnId, showText = "Show", hideText = "Hide") {
    try {
      const el = document.getElementById(targetId);
      const btn = document.getElementById(btnId);
      if (!el || !btn) return;

      // If it's currently masked (password or type not text), reveal it
      if (el.type === "password" || el.getAttribute("data-masked") === "true") {
        el.type = "text";
        el.setAttribute("data-masked", "false");
        btn.textContent = hideText;
        btn.setAttribute("aria-pressed", "true");
      } else {
        el.type = "password";
        el.setAttribute("data-masked", "true");
        btn.textContent = showText;
        btn.setAttribute("aria-pressed", "false");
      }
    } catch (err) {
      console.error(err);
    }
  }

  async restartServer() {
    try {
      if (!confirm("Restart the server now? This will stop the current process and attempt to start a new one.")) return;

      await fetch("/dashboard/api/config/restart", {
        method: "POST",
      })
        .then(async (response) => {
          if (response.ok) {
            alert("Server restart initiated. This session will end when the server shuts down.");
          } else {
            alert("Failed to restart server: " + (await response.text()));
          }
        })
        .catch((err) => {
          console.error(err);
          alert("Error requesting restart: " + err);
        });
    } catch (err) {
      console.error(err);
    }
  }

  async loadUsers() {
    if (!document.getElementById("users-table")) {
      return;
    }

    try {
      await fetch("/dashboard/api/users/get", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page: this.usersCurrentPage, pageSize: this.usersPagesize, query: this.usersCurrentQuery }),
      })
      .then(response => response.json())
      .then(async response => {
        this.lastUserResponseCount = response.data.length;

        if (this.lastUserResponseCount === 0 && this.usersCurrentPage > 1) { // If the page is empty
          this.usersCurrentPage -= 1;
          return this.loadUsers();
        }

        const tbody = document.getElementById('users-table-body');
        tbody.innerHTML = "";

        response.data.forEach(user => {
          const row = document.createElement('tr');
          row.innerHTML = `
            <th>
              <input
                style="background-color: transparent; margin: 0; padding: 0; border: none; box-shadow: none; text-align: center;"
                value="${user.UserName == null ? "Anonymous" : user.UserName}"
                data-field="UserName"
                data-mayhem-id="${user.MayhemId}"
                onchange="API.usersHandleInputChange(this)"
              >
            </th>
            <th>
              <input
                style="background-color: transparent; margin: 0; padding: 0; border: none; box-shadow: none; text-align: center;"
                value="${user.UserEmail == null ? "Anonymous" : user.UserEmail}"
                data-field="UserEmail"
                data-mayhem-id="${user.MayhemId}"
                onchange="API.usersHandleInputChange(this)"
              >
            </th>
            <th>
              <input
                style="background-color: transparent; margin: 0; padding: 0; border: none; box-shadow: none; text-align: center;"
                value="${user.MayhemId}"
                data-field="MayhemId"
                data-mayhem-id="${user.MayhemId}"
                onchange="API.usersHandleInputChange(this)"
              >
            </th>
            <th>
              <input
                style="background-color: transparent; margin: 0; padding: 0; border: none; box-shadow: none; text-align: center;"
                value="${user.UserId}"
                data-field="UserId"
                data-mayhem-id="${user.MayhemId}"
                onchange="API.usersHandleInputChange(this)"
              >
            </th>
            <th>
              <button style="background-color: #4CAF50;" onclick="API.resetUserTimers('${user.MayhemId}', '${user.UserName || 'Anonymous'}')">Reset Timers</button>
              <button style="background-color: red; margin-left: 5px;" onclick="API.adminAreYouSure(this, '${user.MayhemId}')">Delete Account</button>
            </th>
          `;
          tbody.appendChild(row);
        });
      });
    } catch (error) {
      console.error(error);
    }
  }

  async usersChangePageSize() {
    try {
      this.usersPagesize = parseInt(document.getElementById("pageSize").value)
      await this.loadUsers();
    } catch (error) {
      console.error(error);
    }
  }

  async usersPreviousPage() {
    try {
      if (this.usersCurrentPage <= 1) return; // First page

      this.usersCurrentPage -= 1;
      await this.loadUsers();
    } catch (error) {
      console.error(error);
    }
  }

  async usersNextPage() {
    try {
      if (this.lastUserResponseCount === 0) return; // Don't go to empty pages

      this.usersCurrentPage += 1;
      await this.loadUsers();
    } catch (error) {
      console.error(error);
    }
  }

  async usersSearch() {
    try {
      this.usersCurrentPage = 1;
      this.usersCurrentQuery = document.getElementById("searchInput").value;

      await this.loadUsers();
    } catch (error) {
      console.error(error);
    }
  }

  usersHandleInputChange(input) {
    try {
      const field = input.dataset.field;
      const mayhemId = input.dataset.mayhemId;
      const newValue = input.value;

      fetch("/dashboard/api/users/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ field, mayhemId, newValue })
      })
      .then(response => {
        if (response.ok && field == "MayhemId") {
          input.dataset.mayhemId = newValue;
        }
      });

    } catch (error) {
      console.error(error);
    }
  }

  async adminAreYouSure(deleteButton, mayhemId) {
    try {
      deleteButton.innerHTML = "Are you sure?";
      deleteButton.onclick = () => this.adminDeleteAccount(mayhemId);

    } catch (error) {
      console.error(error);
    }
  }

  async adminDeleteAccount(mayhemId) {
    try {
      fetch("/dashboard/api/users/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ mayhemId: mayhemId.toString() })
      })
      .then(async response => {
        if (response.ok) {
          await this.loadUsers();
        }
      });

    } catch (error) {
      console.error(error);
    }
  }

  async resetUserTimers(mayhemId, userName) {
    try {
      const response = await fetch("/mh/games/admin/resetTimers/" + mayhemId, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (response.ok) {
        alert(`Timers reset for ${userName} (${mayhemId})`);
      } else {
        alert(`Failed to reset timers for ${userName}`);
      }
    } catch (error) {
      console.error(error);
      alert("Error resetting timers");
    }
  }

  async loadSavefiles() {
    if (!document.getElementById("savefiles-table")) {
      return;
    }

    try {
      await fetch("/dashboard/api/savefiles/get", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page: this.savefilesCurrentPage, pageSize: this.savefilesPagesize, query: this.savefilesCurrentQuery }),
      })
      .then(response => response.json())
      .then(async response => {
        this.lastSavefileResponseCount = response.data.length;

        if (this.lastSavefileResponseCount === 0 && this.savefilesCurrentPage > 1) { // If the page is empty
          this.savefilesCurrentPage -= 1;
          return this.loadSavefiles();
        }

        const tbody = document.getElementById('savefiles-table-body');
        tbody.innerHTML = "";

        response.data.forEach(user => {
          const row = document.createElement('tr');
          row.innerHTML = `
            <th>
              <input
                style="background-color: transparent; margin: 0; padding: 0; border: none; box-shadow: none; text-align: center;"
                value="${user.UserName == null ? "Anonymous" : user.UserName}"
                data-field="UserName"
                data-mayhem-id="${user.MayhemId}"
                onchange="API.usersHandleInputChange(this)"
              >
            </th>
            <th>
              <input
                style="background-color: transparent; margin: 0; padding: 0; border: none; box-shadow: none; text-align: center;"
                value="${user.UserEmail == null ? "Anonymous" : user.UserEmail}"
                data-field="UserEmail"
                data-mayhem-id="${user.MayhemId}"
                onchange="API.usersHandleInputChange(this)"
              >
            </th>
            <th>
              <div>
                <input value="${user.DonutCount}">
                <button onclick="API.adminSetDonuts(this, '${user.MayhemId}')">Set Donuts</button>
              </div>

              <form class="admin-town-form" enctype="multipart/form-data">
                <input type="hidden" name="mayhemId" value="${user.MayhemId}">
                <input class="town-input" type="file" name="town" accept=".pb,.land" required data-mayhem-id="${user.MayhemId}">
                <button type="submit">Upload</button>
              </form>
              <button onclick="API.adminExportTown('${user.MayhemId}')">Export Save</button>
              <button style="background-color: red;" onclick="API.adminDeleteTown(this, '${user.MayhemId}')">Delete Save</button>
            </th>
          `;
          tbody.appendChild(row);
        });
      });

      [...document.getElementsByClassName("admin-town-form")].forEach(form => {
        form.addEventListener("submit", async (e) => {
          e.preventDefault();

          const formData = new FormData(form);
          const townInput = form.querySelector(".town-input");

          const response = await fetch('/dashboard/api/savefiles/upload', {
            method: 'POST',
            body: formData
          });
        });
      });
    } catch (error) {
      console.error(error);
    }
  }

  async savefilesChangePageSize() {
    try {
      this.savefilesPagesize = parseInt(document.getElementById("pageSize").value)
      await this.loadSavefiles();
    } catch (error) {
      console.error(error);
    }
  }

  async savefilesPreviousPage() {
    try {
      if (this.savefilesCurrentPage <= 1) return; // First page

      this.savefilesCurrentPage -= 1;
      await this.loadSavefiles();
    } catch (error) {
      console.error(error);
    }
  }

  async savefilesNextPage() {
    try {
      if (this.lastUserResponseCount === 0) return; // Don't go to empty pages

      this.savefilesCurrentPage += 1;
      await this.loadSavefiles();
    } catch (error) {
      console.error(error);
    }
  }

  async savefilesSearch() {
    try {
      this.savefilesCurrentPage = 1;
      this.savefilesCurrentQuery = document.getElementById("searchInput").value;

      await this.loadSavefiles();
    } catch (error) {
      console.error(error);
    }
  }

  async adminSetDonuts(button, mayhemId) {
    try {
      const container = button.closest("div");

      const input = container?.querySelector("input");
      const donutsValue = input?.value?.trim();

      fetch("/dashboard/api/savefiles/setDonuts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ mayhemId, donuts: donutsValue })
      });

    } catch (error) {
      console.error(error);
    }
  }

  async adminExportTown(mayhemId) {
    const link = document.createElement('a');
    link.href = `/dashboard/api/savefiles/export?mayhemId=${mayhemId}`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async adminDeleteTown(button, mayhemId) {
    try {
      await fetch(`/dashboard/api/savefiles/delete?mayhemId=${mayhemId}`, {
        method: "POST"
      }).then(async response => {
        button.innerHTML = await response.text();
      });
    } catch (error) {
      console.error(error);
    }
  }

  async signUp() {
    try {
      const emailInput = document.getElementById("email-input");

      await fetch("/userdash/api/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: emailInput.value }),
      })
      .then(async response => {
        if (response.ok) {
          document.getElementById("info-message").style.backgroundColor = "#008ff5";
          document.getElementById("info-message").style.display = "block";

          document.getElementById("info-message").innerHTML = await response.text();
        } else {
          document.getElementById("info-message").style.backgroundColor = "red";
          document.getElementById("info-message").style.display = "block";

          document.getElementById("info-message").innerHTML = await response.text();
        }
      });

    } catch (error) {
      console.error(error);
    }
  }

  async sendCode() {
    try {
      const emailInput = document.getElementById("email-input");
      const codeInput = document.getElementById("code-input");

      const codeButton = document.getElementById("code-button");
      const loginButton = document.getElementById("login-button");

      await fetch("/userdash/api/sendCode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: emailInput.value }),
      })
      .then(async response => {
        if (response.ok) {
          codeInput.style.display = "block";
          emailInput.disabled = true;

          loginButton.style.display = "block";
          codeButton.style.display = "none";
        } else {
          document.getElementById("info-message").style.backgroundColor = "red";
          document.getElementById("info-message").style.display = "block";

          document.getElementById("info-message").innerHTML = await response.text();
        }
      });

    } catch (error) {
      console.error(error);
    }
  }

  async login() {
    try {
      const emailInput = document.getElementById("email-input");
      const codeInput = document.getElementById("code-input");

      await fetch("/userdash/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: emailInput.value, code: codeInput.value }),
      })
      .then(async response => {
        if (response.ok) {
          window.location = "/userdash";
        } else {
          document.getElementById("info-message").style.backgroundColor = "red";
          document.getElementById("info-message").style.display = "block";

          document.getElementById("info-message").innerHTML = await response.text();
        }
      });

    } catch (error) {
      console.error(error);
    }
  }

  async startServer() {
    try {
      await fetch("/dashboard/api/general/start", {
        method: "POST",
      });
    } catch (error) {
      console.error(error);
    }

    this.getStatistics();
  }

  async stopServer() {
    try {
      await fetch("/dashboard/api/general/stop", {
        method: "POST",
      });
    } catch (error) {
      console.error(error);
    }

    this.getStatistics();
  }

  async adminLogout() {
    try {
      await fetch("/dashboard/logout", {
        method: "POST",
      });
    } catch (error) {
      console.error(error);
    }

    window.location.reload();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  API = new Api();
  API.initialize();
});

// Clean up intervals and event sources when page unloads
window.addEventListener("beforeunload", () => {
  if (API) {
    API.cleanup();
    if (API._logEventSource) {
      API._logEventSource.close();
      API._logEventSource = null;
    }
  }
});

// --- Logs related methods ---
Api.prototype.initLogs = function () {
  try {
    this.refreshLogs();
    this.startLogStream();
  } catch (err) {
    console.error(err);
  }
};

Api.prototype.refreshLogs = async function (lines = 500) {
  try {
    await fetch(`/dashboard/api/logs?lines=${lines}`, { method: "GET" })
      .then((r) => r.json())
      .then((resp) => {
        const out = document.getElementById("log-output");
        if (!out) return;
        // convert ANSI to HTML and set
        out.innerHTML = resp.data.map(l => this.ansiToHtml(l)).join('<br>');
        if (document.getElementById("log-autoscroll").checked) {
          out.scrollTop = out.scrollHeight;
        }
      });
  } catch (err) {
    console.error("Failed to refresh logs:", err);
  }
};

Api.prototype.clearLogs = function () {
  const out = document.getElementById("log-output");
  if (!out) return;
  // Request server to clear the log file and try to clear server console
  fetch('/dashboard/api/logs/clear', { method: 'POST' })
    .then(async (resp) => {
      if (!resp.ok) {
        console.error('Failed to clear server logs:', await resp.text());
        return;
      }
      try {
        const j = await resp.json();
        // Replace UI with returned post-clear contents (or empty when cleared)
        if (j.cleared) {
          out.innerHTML = '';
        } else {
          out.innerHTML = (j.data || []).map(l => this.ansiToHtml(l)).join('<br>');
        }
        if (document.getElementById("log-autoscroll").checked) {
          out.scrollTop = out.scrollHeight;
        }

        // If server stdout is not a TTY, inform user; else attempt to briefly restart the stream to avoid racey appended lines
        if (!j.stdoutIsTTY) {
          alert('Server log file cleared, but server process stdout is not a TTY so the remote console could not be cleared.');
        }

        // If the logs were cleared, restart the EventSource to avoid showing buffered/early appended lines
        if (j.cleared) {
          try {
            if (this._logEventSource) {
              this._logEventSource.close();
              this._logEventSource = null;
            }
            // Re-open after a short delay so the server has time to recreate/truncate file
            setTimeout(() => this.startLogStream(), 300);
          } catch (e) {
            console.error('Error restarting log stream after clear:', e);
          }
        }
      } catch (err) {
        console.error('Error parsing clear response:', err);
      }
    })
    .catch((err) => console.error('Error clearing server logs:', err));
  
  // Clear local browser console and ensure UI cleared while awaiting server response
  console.clear();
};

Api.prototype.toggleAutoRefresh = function (enabled) {
  try {
    if (enabled) {
      this.startLogStream();
    } else {
      if (this._logEventSource) {
        this._logEventSource.close();
        this._logEventSource = null;
      }
    }
  } catch (err) {
    console.error('Error toggling auto-refresh:', err);
  }
};

Api.prototype.startLogStream = function () {
  try {
    if (typeof EventSource === "undefined") return; // not supported
    // Respect Auto-Refresh checkbox — if present and unchecked, don't start stream
    const auto = (typeof document !== 'undefined') ? document.getElementById('log-autorefresh') : null;
    if (auto && !auto.checked) {
      if (this._logEventSource) {
        this._logEventSource.close();
        this._logEventSource = null;
      }
      return;
    }

    if (this._logEventSource) this._logEventSource.close();

    const es = new EventSource("/dashboard/api/logs/stream");
    this._logEventSource = es;
    es.onmessage = (evt) => {
      try {
        const out = document.getElementById("log-output");
        if (!out) return;
        const chunk = JSON.parse(evt.data);
        // chunk is a newline-joined string of new lines
        if (chunk && chunk.length > 0) {
          const html = this.ansiToHtml(chunk);
          out.innerHTML += (out.innerHTML.length ? '<br>' : '') + html;
          if (document.getElementById("log-autoscroll").checked) {
            out.scrollTop = out.scrollHeight;
          }
        }
      } catch (err) {
        console.error("Error handling log stream message:", err);
      }
    };
    es.onerror = (e) => {
      // try reconnect by closing — browser will reconnect automatically because of retry
      console.error("Log stream error", e);
    };
  } catch (err) {
    console.error(err);
  }
};

// ANSI to HTML converter (basic)
Api.prototype.ansiToHtml = function (str) {
  if (!str) return '';
  // escape HTML
  const esc = (s) => s.replace(/[&<>\"]+/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; });
  const s = esc(str);
  const regex = /\x1b\[([0-9;]+)m/g; // matches ESC[<codes>m
  let out = '';
  let last = 0;
  let match;
  let open = false;
  while ((match = regex.exec(s)) !== null) {
    out += s.substring(last, match.index);
    const codes = match[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0 || code === 39) {
        if (open) { out += '</span>'; open = false; }
      } else {
        const map = {
          30: 'black', 31: 'red', 32: 'green', 33: 'yellow', 34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white',
          90: 'gray'
        };
        const cls = map[code];
        if (cls) {
          if (open) out += '</span>';
          out += `<span class="ansi-${cls}">`;
          open = true;
        }
      }
    }
    last = regex.lastIndex;
  }
  out += s.substring(last);
  if (open) out += '</span>';
  // preserve spacing
  return out.replace(/\n/g, '<br>');
};

// -- Backups -- \\

Api.prototype.refreshBackups = async function () {
  try {
    const response = await fetch("/dashboard/api/backups/list", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.error("Failed to fetch backups");
      return;
    }

    const data = await response.json();

    // Update statistics
    document.getElementById("stat-backup-count").innerText = data.backupCount || 0;
    document.getElementById("stat-total-size").innerText = data.formattedTotalSize || "0 B";

    // Build backup list HTML
    const list = document.getElementById("backups-list");
    if (!data.backups || data.backups.length === 0) {
      list.innerHTML = "<p>No backups available yet.</p>";
      return;
    }

    let html = "<table style='width: 100%; border-collapse: collapse;'>";
    html += "<thead><tr style='background-color: #333; color: white;'>";
    html += "<th style='padding: 10px; text-align: left; border: 1px solid #555;'>Date Created</th>";
    html += "<th style='padding: 10px; text-align: left; border: 1px solid #555;'>Reason</th>";
    html += "<th style='padding: 10px; text-align: left; border: 1px solid #555;'>Size</th>";
    html += "<th style='padding: 10px; text-align: left; border: 1px solid #555;'>Files</th>";
    html += "<th style='padding: 10px; text-align: center; border: 1px solid #555;'>Actions</th>";
    html += "</tr></thead><tbody>";

    for (const backup of data.backups) {
      html += "<tr style='background-color: #2a2a2a; color: #e0e0e0; border-bottom: 1px solid #444;'>";
      html += `<td style='padding: 10px; border: 1px solid #444;'>${backup.created}</td>`;
      html += `<td style='padding: 10px; border: 1px solid #444;'>${backup.reason}</td>`;
      html += `<td style='padding: 10px; border: 1px solid #444;'>${backup.formattedSize}</td>`;
      html += `<td style='padding: 10px; border: 1px solid #444;'>${backup.files.join(", ")}</td>`;
      html += `<td style='padding: 10px; border: 1px solid #444; text-align: center;'>`;
      html += `<button style='background-color: #0066cc; color: white; padding: 5px 10px; margin: 0 2px; border: none; border-radius: 3px; cursor: pointer;' onclick="API.restoreBackup('${backup.name}')">Restore</button>`;
      html += `<button style='background-color: #dd3333; color: white; padding: 5px 10px; margin: 0 2px; border: none; border-radius: 3px; cursor: pointer;' onclick="API.deleteBackupConfirm('${backup.name}')">Delete</button>`;
      html += `</td></tr>`;
    }

    html += "</tbody></table>";
    list.innerHTML = html;
  } catch (error) {
    console.error("Error refreshing backups:", error);
    document.getElementById("backups-list").innerHTML = "<p>Error loading backups</p>";
  }
};

Api.prototype.createBackup = async function () {
  try {
    const button = event.target;
    button.disabled = true;
    button.innerText = "Creating...";

    const response = await fetch("/dashboard/api/backups/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "manual" }),
    });

    if (!response.ok) {
      alert("Failed to create backup");
      button.disabled = false;
      button.innerText = "Create Backup Now";
      return;
    }

    const data = await response.json();
    alert("Backup created successfully: " + data.backup.name);
    button.disabled = false;
    button.innerText = "Create Backup Now";
    this.refreshBackups();
  } catch (error) {
    console.error("Error creating backup:", error);
    alert("Error creating backup: " + error.message);
    event.target.disabled = false;
    event.target.innerText = "Create Backup Now";
  }
};

Api.prototype.deleteBackupConfirm = function (backupName) {
  if (confirm(`Are you sure you want to delete the backup "${backupName}"? This cannot be undone.`)) {
    this.deleteBackup(backupName);
  }
};

Api.prototype.deleteBackup = async function (backupName) {
  try {
    const response = await fetch("/dashboard/api/backups/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupName }),
    });

    if (!response.ok) {
      alert("Failed to delete backup");
      return;
    }

    const data = await response.json();
    alert("Backup deleted: " + backupName);
    this.refreshBackups();
  } catch (error) {
    console.error("Error deleting backup:", error);
    alert("Error deleting backup: " + error.message);
  }
};

Api.prototype.restoreBackup = async function (backupName) {
  if (!confirm(`Are you sure you want to restore from backup "${backupName}"? This will replace your current data directory and user.db with the backup version.`)) {
    return;
  }

  try {
    const response = await fetch("/dashboard/api/backups/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupName }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 503 && data.requiresServerStop) {
        alert(
          "⚠️ Database file is locked by running server.\n\n" +
          "To restore this backup:\n" +
          "1. Click the 'Stop Server' button in the toolbar\n" +
          "2. Wait for the server to stop\n" +
          "3. Click 'Restore Backup' again\n" +
          "4. Click the 'Start Server' button when done\n\n" +
          data.error
        );
      } else {
        alert("Restore failed: " + (data.error || response.statusText));
      }
      return;
    }

    alert("Backup restored successfully!\n\n⚠️ IMPORTANT: You must fully restart the Node.js server process:\n\n1. Stop the server by pressing Ctrl+C in the terminal\n2. Run 'npm start' to restart it\n\nThe 'Start Server' button only clears the pause flag—it cannot reopen a closed database connection.");
    this.refreshBackups();
  } catch (error) {
    console.error("Error restoring backup:", error);
    alert("Error restoring backup: " + error.message);
  }
};

