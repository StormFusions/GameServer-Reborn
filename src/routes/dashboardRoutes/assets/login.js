document
  .getElementById("login-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const key = document.getElementById("key").value;

    try {
      const response = await fetch("/dashboard/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key }),
      });

      if (response.ok) {
        window.location.reload();
      } else {
        document.getElementById("error-message").style.display = "block";
      }
    } catch (error) {
      logger.error(error, "Error");
    }
  });
