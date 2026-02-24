import { Router, json } from "express";

import cookieParser from "cookie-parser";
import fileUpload from "express-fileupload";

import nodemailer from "nodemailer";

import db from "../../lib/db.js";

import apiController from "./api/api.controller.js";

import config from "../../../config.json" with { type: "json" };

import { randomBytes } from "crypto";

import generateToken from "../authRoutes/connect/tokenGen.js";

import fs from "fs";
import { logger } from "../../lib/logger.js";

const router = Router();

router.use(cookieParser());
router.use(json());

// Mount the API controller for user dashboard API endpoints
router.use("/api", apiController);

function randomInt(min, max) { // https://stackoverflow.com/questions/4959975/generate-random-number-between-two-numbers-in-javascript
  return Math.floor(Math.random() * (max - min + 1) + min);
}

router.get("/", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;

    const USER_EXISTS_BY_TOKEN_QUERY = "SELECT 1 from UserData WHERE UserAccessToken = ?;";
    await db.get(USER_EXISTS_BY_TOKEN_QUERY, [token], async (error, row) => {
      if (error) {
        logger.error(error, "Error executing query:");
        res.status(500).send("Internal error");
        return;
      }

      if (!row) {
        res.render("user-dashboard/unauthed");
        return;
      }

      res.render("user-dashboard/userdash");
    });
  } catch (error) {
    next(error);
  }
});

router.get("/signup", async (req, res, next) => {
  try {
    res.render("user-dashboard/signup")
  } catch (error) {
    next(error);
  }
});

router.get("/login", async (req, res, next) => {
  try {
    res.render("user-dashboard/login");
  } catch (error) {
    next(error);
  }
});

router.post("/api/signup", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).send("Missing field: email");
      return;
    }

    const LAST_USER_QUERY =
      "SELECT MayhemId, UserId from UserData ORDER BY UserId DESC LIMIT 1;";
    await db.get(LAST_USER_QUERY, async (error, row) => {
      // Get the last created user, so we can make the new users ids +1
      if (error) {
        logger.error(error, "Error executing query");
        res.status(500).send("Internal error");
        return;
      }

      const newUID = row
        ? Number(row.UserId) + 1
        : config.startingUID + 1; /* If there are no users */
      const newMID = row
        ? BigInt(row.MayhemId) + 1n
        : BigInt(config.startingMID) + 1n; /* If there are no users */

      const newAccessToken = generateToken("AT", newUID.toString());
      const newAccessCode = generateToken("AC", newUID.toString());

      const NEW_USER_QUERY = `INSERT INTO UserData (UserId, MayhemId, UserEmail, UserName, UserAccessToken, UserAccessCode) VALUES (?, ?, ?, ?, ?, ?)`;
      await db.run(NEW_USER_QUERY, [newUID, newMID.toString(), email, `${email.toLowerCase().split("@")[0]}_${randomBytes(2).toString("hex").slice(0, 4)}`, newAccessToken, newAccessCode], async (error, row) => {
        if (error) {
          if (error.message.includes('SQLITE_CONSTRAINT: UNIQUE constraint failed: UserData.UserEmail')) {
            res.status(400).send("Email already in use");
          } else {
            logger.error(error, "Error executing query:");
            res.status(500).send("Internal Error");
          }

          return;
        }

        res.status(200).send("User created successfully");
      });
    });

  } catch (error) {
    next(error);
  }
});

router.post("/api/login", async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email) {
      res.status(400).send("Missing field: email");
      return;
    }
    if (!code) {
      res.status(400).send("Missing field: code");
      return;
    }
	
    const USER_BY_EMAIL =
      "SELECT UserAccessToken, UserCred FROM UserData WHERE UserEmail = ?;";
    await db.get(USER_BY_EMAIL, [email], async (error, row) => {
      if (error) {
        logger.error(error, "Error executing query:");
        res.status(500).send({ message: "Internal error" });
        return;
      }

      if (!row) {
        res.status(404).send({ message: "No users found with that email" });
        return;
      }

      if (row.UserCred != code && config.useSMTP) {
        res.status(400).send("Invalid code");
        return;
      }

      res.cookie("userToken", row.UserAccessToken, {
        httpOnly: true, // Prevent client-side JS from accessing the cookie
        sameSite: "Strict",
        maxAge: 1728000000, // 48 hours
      });

      res.status(200).send("Logged you in");
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/logout", async (req, res, next) => {
  try {
    res.clearCookie("userToken");
    res.status(200).send("Logged you out");
  } catch (error) {
    next(error);
  }
});


router.post("/api/sendCode", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).send("Missing field: email");
      return;
    }

    const USER_EXISTS_BY_MAIL_QUERY = "SELECT 1 from UserData WHERE UserEmail = ?;";
    await db.get(USER_EXISTS_BY_MAIL_QUERY, [email], async (error, row) => {
      if (error) {
        logger.error(error, "Error executing query:");
        res.status(500).send("Internal error");
        return;
      }

      if (!row) {
        res.status(400).send("Could not find a user with the email");
        return;
      }
	
      if(config.useTSTO_API) {
	      try {
          const url = `https://api.tsto.app/api/auth/sendCode?apikey=${encodeURIComponent(config.TSTO_APIkey)}&emailAddress=${encodeURIComponent(email)}&teamName=${encodeURIComponent(config.TSTO_APIteam)}`;
          const resp = await fetch(url, { method: "POST" });
          const data = await resp.json();

          const UPDATE_CRED_BY_EMAIL = "UPDATE UserData SET UserCred = ? WHERE UserEmail = ?;";
          await db.run(UPDATE_CRED_BY_EMAIL, [data.code, email]);
        } catch (err) {
          logger.error(err, "Error in sendCode");
        }
      } else if (config.useSMTP) {
        const transporter = nodemailer.createTransport({
          host: config.SMTPhost,
          port: config.SMTPport,
          secure: config.SMTPsecure,
          auth: {
            user: config.SMTPuser,
            pass: config.SMTPpass,
          }
        });

        const newCode = randomInt(10000, 99999);

        const mailOptions = {
          from: config.SMTPuser,
          to: email,
          subject: `Verification Code For The Simpsons: Tapped Out - ${newCode}`,
          text: `Your Code: ${newCode}`
         };

         const UPDATE_CRED_BY_EMAIL = "UPDATE UserData SET UserCred = ? WHERE UserEmail = ?;";
         await db.run(UPDATE_CRED_BY_EMAIL, [newCode, email]);

         transporter.sendMail(mailOptions, function(error, info) {
           if (error) {
             logger.error(error, "Error in sendMail");
           }
         });
      }

      res.status(200).send("Sendt code");

    });

  } catch (error) {
    next(error);
  }
});

router.get("/api/getAccountInfo", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;

    const USERINFO_BY_TOKEN_QUERY = "SELECT UserName, UserEmail from UserData WHERE UserAccessToken = ?;";
    await db.get(USERINFO_BY_TOKEN_QUERY, [token], async (error, row) => {
      if (error) {
        logger.error(error, "Error executing query:");
        res.status(500).send("Internal error");
        return;
      }

      if (!row) {
        res.status(400).send("No user found with that token")
        return;
      }

      res.json({ username: row.UserName, email: row.UserEmail });
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/changeUsername", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;

    const { username } = req.body;
    if (!username) {
      res.status(400).send("Missing field: username");
      return;
    }

    const USERINFO_BY_TOKEN_QUERY = "SELECT 1 from UserData WHERE UserAccessToken = ?;";
    await db.get(USERINFO_BY_TOKEN_QUERY, [token], async (error, row) => {
      if (error) {
        logger.error(error, "Error executing query:");
        res.status(500).send("Internal error");
        return;
      }

      if (!row) {
        res.status(400).send("No user found with that token")
        return;
      }

      const UPDATE_USERNAME_BY_TOKEN = "UPDATE UserData SET UserName = ? WHERE UserAccessToken = ?;"
      await db.run(UPDATE_USERNAME_BY_TOKEN, [username, token])

      res.status(200).send("Updated username");
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/changeEmail", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;

    const { email } = req.body;
    if (!email) {
      res.status(400).send("Missing field: email");
      return;
    }

    const USERINFO_BY_TOKEN_QUERY = "SELECT 1 from UserData WHERE UserAccessToken = ?;";
    await db.get(USERINFO_BY_TOKEN_QUERY, [token], async (error, row) => {
      if (error) {
        logger.error(error, "Error executing query:");
        res.status(500).send("Internal error");
        return;
      }

      if (!row) {
        res.status(400).send("No user found with that token");
        return;
      }

      const UPDATE_EMAIL_BY_TOKEN = "UPDATE UserData SET UserEmail = ? WHERE UserAccessToken = ?;";
      await db.run(UPDATE_EMAIL_BY_TOKEN, [email, token]);

      res.status(200).send("Updated email");
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/deleteAccount", async (req, res, next) => {
  try {
    const token = req.cookies.userToken;

    const USERINFO_BY_TOKEN_QUERY = "SELECT MayhemId from UserData WHERE UserAccessToken = ?;";
    await db.get(USERINFO_BY_TOKEN_QUERY, [token], async (error, row) => {
      if (error) {
        logger.error(error, "Error executing query:");
        res.status(500).send("Internal error");
        return;
      }

      if (!row) {
        res.status(400).send("No user found with that token");
        return;
      }

      const DELETE_USER_BY_TOKEN = "DELETE FROM UserData WHERE UserAccessToken = ?;";
      await db.run(DELETE_USER_BY_TOKEN, [token]);

      if (fs.existsSync(config.dataDirectory + "/" + row.MayhemId))
        fs.rmSync(config.dataDirectory + "/" + row.MayhemId, { recursive: true, force: true });

      res.status(200).send("Deleted user");
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/uploadTown", fileUpload(), async (req, res, next) => {
  try {
    const token = req.cookies.userToken;

    if (!req.files?.town) return res.status(400).send("No town uploaded");

    const USERINFO_BY_TOKEN_QUERY = "SELECT LandSavePath, MayhemId from UserData WHERE UserAccessToken = ?;";
    await db.get(USERINFO_BY_TOKEN_QUERY, [token], async (error, row) => {
      if (error) {
        logger.error(error, "Error executing query:");
        res.status(500).send("Internal error");
        return;
      }

      if (!row) {
        res.status(400).send("No user found with that token");
        return;
      }

      let savePath = row.LandSavePath;
      if (!savePath) {
        savePath = `${config.dataDirectory}/${row.MayhemId}/${row.MayhemId}.land`;

        const UPDATE_QUERY = `UPDATE UserData SET LandSavePath = ? WHERE MayhemId = ?`;
        db.run(UPDATE_QUERY, [savePath, row.MayhemId], async function (error) {
          if (error) {
            logger.error(error, "Error:");
            res.status(500).send("Internal error");
            return;
          }
        });
      }

      if (!fs.existsSync(config.dataDirectory + "/" + row.MayhemId))
        fs.mkdirSync(config.dataDirectory + "/" + row.MayhemId);

      const town = req.files.town;
      town.mv(savePath, (err) => {
        if (err) return res.status(500).send(err);

        res.status(200).send("Town uploaded");
      });
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api/exportTown", fileUpload(), async (req, res, next) => {
  try {
    const token = req.cookies.userToken;

    const USERINFO_BY_TOKEN_QUERY = "SELECT LandSavePath from UserData WHERE UserAccessToken = ?;";
    await db.get(USERINFO_BY_TOKEN_QUERY, [token], async (error, row) => {
      if (error) {
        logger.error(error, "Error executing query:");
        res.status(500).send("Internal error");
        return;
      }

      if (!row) {
        res.status(400).send("No user found with that token")
        return;
      }

      if (!row.LandSavePath) {
        res.status(500).send("Land not found");
        return;
      }

      res.download(row.LandSavePath, (err) => {
        if (err) {
          logger.error(err, "Download error");
          // res.status(500).send("Error sending file"); Makes the server crash
        }
      });

    });
  } catch (error) {
    next(error);
  }
});

export default router;
