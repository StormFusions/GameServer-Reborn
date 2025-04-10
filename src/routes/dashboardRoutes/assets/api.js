class Api {
  async initialize() {
    try {
      this.setupEventListeners();

      this.getStatistics();
      setInterval(this.getStatistics, 60000);

      this.getEvent();

      this.getAccountInfo();

      this.usersCurrentPage = 1;
      this.lastUserResponseCount = 0;
      this.usersPagesize = 10;
      this.usersCurrentQuery = "";
      this.loadUsers();
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
              <button style="background-color: red;" onclick="API.adminAreYouSure(this, ${user.MayhemId})">Delete Account</button>
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
        body: JSON.stringify({ mayhemId })
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
