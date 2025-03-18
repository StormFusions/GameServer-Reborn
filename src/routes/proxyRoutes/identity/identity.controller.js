import { Router, raw } from "express";

import nodemailer from "nodemailer";

import crypto from "crypto";

import sqlite3 from "sqlite3";

import config from "../../../../config.json" with { type: "json" };

const db = new sqlite3.Database(
  config.dataDirectory + "/users.db",
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (error) => {
    if (error) {
      console.error("Error opening database:", error.message);
    }
  },
);

const router = Router();

function randomInt(min, max) { // https://stackoverflow.com/questions/4959975/generate-random-number-between-two-numbers-in-javascript
  return Math.floor(Math.random() * (max - min + 1) + min);
}

router.get("/pids//personas", async (req, res, next) => {
  try {
    res
      .status(404)
      .send({ error: "not_found", error_description: "no mediator found" });
  } catch (error) {
    next(error);
  }
});

router.get("/pids/:who/personas", async (req, res, next) => {
  // EA Accounts
  try {
    const token = req.headers["authorization"].split(" ")[1];
    if (!token) {
      res.status(400).send({ message: "No Authorization Header" });
      return;
    }

    const USER_BY_UID_QUERY =
      "SELECT UserId, UserAccessToken FROM UserData WHERE UserId = ?;";
    await db.get(USER_BY_UID_QUERY, [req.params.who], async (error, row) => {
      if (!row) {
        res
          .status(400)
          .send({ message: "No user could be found with that UserId" });
        return;
      }

      if (row.UserAccessToken != token) {
        res.status(400).send({ message: "Tokens do not match" });
        return;
      }

      res.status(200).send({
        personas: {
          persona: [
            {
              dateCreated: "2024-11-05T18:35Z", // Not important, so random date
              displayName: row.UserName ? row.UserName : "user",
              isVisible: true,
              lastAuthenticated: "",
              name: row.UserName ? row.UserName : "user",
              namespaceName: row.UserEmail
                ? "cem_ea_id"
                : "gsp-redcrow-simpsons4",
              personaId: row.UserId,
              pidId: row.UserId,
              showPersona: "EVERYONE",
              status: "ACTIVE",
              statusReasonCode: "",
            },
          ],
        },
      });
    });
  } catch (error) {
    next(error);
  }
});

router.get("/pids/me/personas/:who", async (req, res, next) => {
  // Anonymous Accounts
  try {
    const token = req.headers["authorization"].split(" ")[1];
    if (!token) {
      res.status(400).send({ message: "No Authorization Header" });
      return;
    }

    const USER_BY_UID_QUERY =
      "SELECT UserId, UserAccessToken, UserEmail, UserName FROM UserData WHERE UserId = ?;";
    await db.get(USER_BY_UID_QUERY, [req.params.who], async (error, row) => {
      if (!row) {
        res
          .status(400)
          .send({ message: "No user could be found with that UserId" });
        return;
      }

      if (row.UserAccessToken != token) {
        res.status(400).send({ message: "Tokens do not match" });
        return;
      }

      res.status(200).send({
        persona: {
          anonymousId: "user",
          dateCreated: "2024-12-12T15:42Z",
          displayName: row.UserName ? row.UserName : "user",
          isVisible: true,
          lastAuthenticated: "",
          name: row.UserName ? row.UserName : "user",
          namespaceName: row.UserEmail ? "cem_ea_id" : "gsp-redcrow-simpsons4",
          personaId: row.UserId,
          pidId: row.UserId,
          showPersona: "EVERYONE",
          status: "ACTIVE",
          statusReasonCode: "",
        },
      });
    });
  } catch (error) {
    next(error);
  }
});

router.get("/geoagerequirements", async (req, res, next) => {
  // TODO: Replace hardcoded values with dynamic ones
  try {
    res.status(200).send({
      geoAgeRequirements: {
        country: "NO",
        minAgeWithConsent: "3",
        minLegalContactAge: 13,
        minLegalRegAge: 13,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/progreg/code", raw({ type: "*/*" }), async (req, res, next) => {
  try {
    const token = req.headers["authorization"].split(" ")[1];
    if (!token) {
      res.status(400).send({ message: "No Authorization Header" });
      return;
    }

    let body;
    try {
      body = JSON.parse(req.body.toString().trim());
    } catch (error) {
      res.status(400).send({ message: "Invalid JSON" });
      return;
    }

    const { codeType } = body;
    if (!codeType || codeType !== "EMAIL") {
      res.status(400).send({ message: "Invalid codeType" });
      return;
    }

    const { email } = body;
    if (!email) {
      res.status(400).send({ message: "Missing Field: email" });
      return;
    }

    const USER_BY_TOKEN = "SELECT 1 FROM UserData WHERE UserAccessToken = ?;"; // Only check for a valid token, don't get any info from it
    await db.get(USER_BY_TOKEN, [token], async (error, row) => {
      if (error) {
        console.error("Error executing query:", error.message);
        res.status(500).send({ message: "Internal error" });
        return;
      }

      if (!row) {
        res.status(400).send({ message: "Invalid token" });
        return;
      }

      const USER_BY_EMAIL = "SELECT 1 FROM UserData WHERE UserEmail = ?;";
      await db.get(USER_BY_EMAIL, [email], async (error, row2) => {
        if (!row2) {
          res.status(400).send({ message: "Invalid email" });
          return;
        }

        if (config.useSMTP) {
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
              console.log("Error:", error);
            }
          });
        }
        res.status(200).send("");
      });
    });
  } catch (error) {
    next(error);
  }
});

router.get("/links", async (req, res, next) => {
  try {
    const token = req.headers["authorization"].split(" ")[1];
    if (!token) {
      res.status(400).send({ message: "No Authorization Header" });
      return;
    }

    const USER_BY_TOKEN =
      "SELECT UserId FROM UserData WHERE UserAccessToken = ?;";
    await db.get(USER_BY_TOKEN, [token], async (error, row) => {
      if (error) {
        console.error("Error executing query:", error.message);
        return;
      }

      if (!row) {
        res.status(400).send({ message: "Invalid token" });
        return;
      }

      res.status(200).send({
        pidGamePersonaMappings: {
          pidGamePersonaMapping: [
            {
              newCreated: false,
              personaId: row.UserId,
              personaNamespace: req.query.personaNamespace
                ? req.query.personaNamespace
                : "gsp-redcrow-simpsons4",
              pidGamePersonaMappingId: row.UserId,
              pidId: row.UserId,
              status: "ACTIVE",
            },
          ],
        },
      });
    });
  } catch (error) {
    next(error);
  }
});

export default router;
