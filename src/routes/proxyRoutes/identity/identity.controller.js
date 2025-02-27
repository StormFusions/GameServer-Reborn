import { Router } from "express";

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
              displayName: "user", // Not implememnted yet
              isVisible: true,
              lastAuthenticated: "",
              name: "user", // Not implemented yet
              namespaceName: "cem_ea_id",
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
        persona: {
          anonymousId: "user",
          dateCreated: "2024-12-12T15:42Z",
          displayName: "user",
          isVisible: true,
          lastAuthenticated: "",
          name: "user",
          namespaceName: "gsp-redcrow-simpsons4",
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

export default router;
