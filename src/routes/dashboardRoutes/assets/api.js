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
        .then(async (response) => {
          if (document.getElementById("event-div")) {
            const eventElement = document.getElementById("event-div");

            await fetch("/dashboard/assets/events.json")
              .then((response) => response.json())
              .then((data) => {
                let eventName = "Now";

                if (response.lobbyTime != 0) {
                  const event = Object.values(data)
                    .flat()
                    .find((e) => e.timestamp == response.lobbyTime);
                  eventName = event
                    ? event.name
                    : `No event found for the current timestamp: ${response.lobbyTime}`;
                }

                document.getElementById("event-div").textContent = eventName;
              });
          }
        });
    } catch (error) {
      console.error(error);
    }
  }

  async signUp() {
    try {
      const emailInput = document.getElementById("email-input");

      await fetch("/userdash/signup", {
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
