import { Router } from "express";

import protobuf from "protobufjs";

import sqlite3 from "sqlite3";

import config from "../../../../config.json" with { type: "json" };

const db = new sqlite3.Database(
  config.dataDirectory + "/users.db",
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (error) => {
    if (error) {
      console.error(
        "[users.controller.js] Error opening database:",
        error.message,
      );
      return;
    }
  },
);

const router = Router();

const QUERY = `
        SELECT MayhemId, UserAccessToken, SessionId, SessionKey
        FROM UserData
        WHERE UserId = ?`;

router.put("/", async (req, res, next) => {
  try {
    const applicationUserId = req.query.applicationUserId;

    const reqToken =
      req.headers["nucleus_token"] || req.headers["mh_auth_params"];
    if (!reqToken) {
      res
        .type("application/xml")
        .status(400)
        .send(
          `<?xml version="1.0" encoding="UTF-8"?>
			<error code="400" type="MISSING_VALUE" field="nucleus_token"/>`,
        );
      return;
    }

    const mh_uid = req.headers["mh_uid"];

    await db.get(QUERY, [applicationUserId], async (error, row) => {
      if (error) {
        console.error("Error executing query:", error.message);
        res
          .type("application/xml")
          .status(500)
          .send(
            `<?xml version="1.0" encoding="UTF-8"?>
					<error code="500" type="INTERNAL_SERVER_ERROR"/>`,
          );
        return;
      }

      if (!row) {
        res
          .type("application/xml")
          .status(404)
          .send(
            `<?xml version="1.0" encoding="UTF-8"?>
					<error code="404" type="NOT_FOUND" field="applicationUserId"/>`,
          );
        return;
      }

      let userData = row;

      if (!reqToken == userData.UserAccessToken) {
        res
          .type("application/xml")
          .status(400)
          .send(
            `<?xml version="1.0" encoding="UTF-8"?>
					<error code="400" type="BAD_REQUEST" field="AcessToken and UserId does not match"/>`,
          );
        return;
      }

      const root = await protobuf.load("TappedOut.proto");
      const UsersResponseMessage = root.lookupType("Data.UsersResponseMessage");

      const MayhemId = userData.MayhemId.toString();
      const SessionKey = ""; // userData.SessionKey.toString();

      let message = UsersResponseMessage.create({
        user: {
          userId: MayhemId,
          telemetryId: "42" /* Not used, but client excpects it */,
        },
        token: { sessionKey: SessionKey },
      });

      res.type("application/x-protobuf"); // Make sure the client knows it's protobuf
      res.send(UsersResponseMessage.encode(message).finish());
    });
  } catch (error) {
    next(error);
  }
});

export default router;
