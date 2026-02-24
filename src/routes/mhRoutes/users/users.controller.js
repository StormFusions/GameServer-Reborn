import { Router } from "express";

import pb from "../../../lib/protobuf.js";

import { dbGet } from "../../../lib/db.js";
import { logger } from "../../../lib/logger.js";

import config from "../../../../config.json" with { type: "json" };

const router = Router();

// Helper: Get token from request headers
const getTokenFromHeaders = (req) => {
  return req.headers["nucleus_token"] || req.headers["mh_auth_params"];
};

// Helper: Send XML error response
const sendXmlError = (res, code, type, field = "") => {
  const fieldAttr = field ? ` field="${field}"` : "";
  res.type("application/xml").status(code).send(
    `<?xml version="1.0" encoding="UTF-8"?><error code="${code}" type="${type}"${fieldAttr}/>`
  );
};

// Queries
const USER_BY_ID_QUERY = `SELECT MayhemId, UserAccessToken, SessionId, SessionKey FROM UserData WHERE UserId = ?`;
const USER_BY_TOKEN_QUERY = `SELECT MayhemId FROM UserData WHERE UserAccessToken = ?`;

router.put("/", async (req, res, next) => {
  try {
    const applicationUserId = req.query.applicationUserId;
    const reqToken = getTokenFromHeaders(req);

    if (!applicationUserId) {
      sendXmlError(res, 400, "MISSING_VALUE", "applicationUserId");
      return;
    }

    if (!reqToken) {
      sendXmlError(res, 400, "MISSING_VALUE", "nucleus_token");
      return;
    }

    const row = await dbGet(USER_BY_ID_QUERY, [applicationUserId]);

    if (!row) {
      sendXmlError(res, 404, "NOT_FOUND", "applicationUserId");
      return;
    }

    if (reqToken !== row.UserAccessToken) {
      sendXmlError(res, 400, "BAD_REQUEST", "AccessToken and UserId does not match");
      return;
    }

    const UsersResponseMessage = pb.lookupType("Data.UsersResponseMessage");
    const MayhemId = row.MayhemId.toString();
    const SessionKey = "";

    let message = UsersResponseMessage.create({
      user: {
        userId: MayhemId,
        telemetryId: "42",
      },
      token: { sessionKey: SessionKey },
    });

    res.type("application/x-protobuf");
    res.send(UsersResponseMessage.encode(message).finish());
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const reqToken = getTokenFromHeaders(req);

    if (!reqToken) {
      sendXmlError(res, 400, "MISSING_VALUE", "nucleus_token");
      return;
    }

    const row = await dbGet(USER_BY_TOKEN_QUERY, [reqToken]);

    if (!row) {
      res.status(404).send("Could not find a user with that token");
      return;
    }

    res
      .type("application/xml")
      .status(200)
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>
        <Resources>
          <URI>/users/${row.MayhemId}</URI>
        </Resources>`
      );
  } catch (error) {
    next(error);
  }
});

export default router;
