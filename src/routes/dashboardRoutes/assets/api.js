class Api {
  async initialize() {
    try {
      this.setupEventListeners();

      this.getStatistics();
      setInterval(this.getStatistics, 60000);

      this.getEvent();

      this.getAccountInfo();
    } catch (error) {
      console.error("Error initializing dashboard:", error);
    }
  }

  setupEventListeners() {
    if (document.getElementById("town-form")) {
      document.getElementById("town-form").addEventListener("submit", async (e) => {
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

  async downloadFile() {
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
