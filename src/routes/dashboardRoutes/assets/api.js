class Api {
  async initialize() {
    try {
      this.setupEventListeners();

      this.getStatistics();
      setInterval(this.getStatistics, 60000);

      this.getEvent();
    } catch (error) {
      console.error("Error initializing dashboard:", error);
    }
  }

  setupEventListeners() {
    // Nothing here yet
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
    try {
      await fetch("/dashboard/api/event/get", {
        method: "GET",
      })
        .then((response) => response.json())
        .then((response) => {
          if (document.getElementById("event-div")) {
            const eventElement = document.getElementById("event-div");

            eventElement.textContent = response.lobbyTime;
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

  async logout() {
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
