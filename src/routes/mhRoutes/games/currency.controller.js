import { Router, raw } from "express";
import fsp from "fs/promises";
import fs from "fs";
import pb from "../../../lib/protobuf.js";
import db, { dbGet, dbRun } from "../../../lib/db.js";
import { logger } from "../../../lib/logger.js";
import sessionManager from "../../../lib/sessionManager.js";
import config from "../../../../config.json" with { type: "json" };

const router = Router();

// Helper to ensure currency file exists and is initialized
const ensureCurrencyFile = async (landId, savePath, startingAmount) => {
  try {
    const st = await fsp.stat(savePath);
    if (st.size > 0) return; // File exists and has content
  } catch (e) {
    // File doesn't exist, create it
  }
  
  const CurrencyData = pb.lookupType("Data.CurrencyData");
  const message = CurrencyData.create({
    id: landId,
    vcTotalPurchased: 0,
    vcTotalAwarded: startingAmount,
    vcBalance: startingAmount,
    createdAt: 1715911362,
    updatedAt: Date.now(),
  });
  await fsp.writeFile(savePath, CurrencyData.encode(message).finish());
};

// GET protocurrency - retrieve currency/donut data
router.get("/bg_gameserver_plugin/protocurrency/:landId", async (req, res, next) => {
  try {
    const landId = req.params.landId;
    const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];

    if (!reqToken) {
      res.type("application/xml").status(400).send(
        `<?xml version="1.0" encoding="UTF-8"?><error code="400" type="MISSING_VALUE" field="nucleus_token"/>`
      );
      return;
    }

    const userData = await dbGet("SELECT UserAccessToken, CurrencySavePath FROM UserData WHERE MayhemId = ?", [landId]);

    if (!userData) {
      res.type("application/xml").status(404).send(
        `<?xml version="1.0" encoding="UTF-8"?><error code="404" type="NOT_FOUND" field="mayhemId"/>`,
      );
      return;
    }

    if (reqToken !== userData.UserAccessToken) {
      res.type("application/xml").status(400).send(
        `<?xml version="1.0" encoding="UTF-8"?><error code="400" type="BAD_REQUEST" field="Invalid AcessToken for specified MayhemId"/>`,
      );
      return;
    }

    const CurrencyData = pb.lookupType("Data.CurrencyData");

    let savePath = userData.CurrencySavePath;
    if (!savePath || savePath == "") {
      savePath = config.dataDirectory + `/${landId}/${landId}.currency`;
      await dbRun("UPDATE UserData SET CurrencySavePath = ? WHERE MayhemId = ?", [savePath, landId]);
    }

    await ensureCurrencyFile(landId, savePath, config.initialDonutAmount);
    res.type("application/x-protobuf").send(await fsp.readFile(savePath));
  } catch (error) {
    next(error);
  }
});

// POST extraLandUpdate - handle incremental donuts/currency updates
router.post(
  "/bg_gameserver_plugin/extraLandUpdate/:landId/protoland/",
  raw({ type: "application/x-protobuf", limit: "52428800" }),
  async (req, res, next) => {
    const landId = req.params.landId;
    const wholeLandToken = req.headers["land-update-token"];

    try {
      const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];
      if (!reqToken) {
        res.type("application/xml").status(400).send(
          `<?xml version="1.0" encoding="UTF-8"?><error code="400" type="MISSING_VALUE" field="nucleus_token"/>`
        );
        return;
      }

      const userData = await dbGet("SELECT UserId, UserAccessToken, WholeLandToken, CurrencySavePath FROM UserData WHERE MayhemId = ?", [landId]);

      if (!userData) {
        res.type("application/xml").status(404).send(
          `<?xml version="1.0" encoding="UTF-8"?><error code="404" type="NOT_FOUND" field="mayhemId"/>`,
        );
        return;
      }

      if (reqToken !== userData.UserAccessToken) {
        logger.warn({ landId, receivedToken: reqToken, storedToken: userData.UserAccessToken }, "extraLandUpdate: AccessToken mismatch");
        res.type("application/xml").status(400).send(
          `<?xml version="1.0" encoding="UTF-8"?><error code="400" type="BAD_REQUEST" field="Invalid AcessToken for specified MayhemId"/>`,
        );
        return;
      }

      if (wholeLandToken && wholeLandToken !== userData.WholeLandToken) {
        logger.debug({ landId, receivedToken: wholeLandToken, storedToken: userData.WholeLandToken }, "extraLandUpdate: WholeLandToken mismatch but proceeding");
      }

      const ExtraLandMessage = pb.lookupType("Data.ExtraLandMessage");
      const ExtraLandResponse = pb.lookupType("Data.ExtraLandResponse");
      const CurrencyDelta = pb.lookupType("Data.CurrencyDelta");
      const CurrencyData = pb.lookupType("Data.CurrencyData");

      let savePath = userData.CurrencySavePath;
      if (!savePath || savePath == "") {
        savePath = config.dataDirectory + `/${landId}/${landId}.currency`;
        await dbRun("UPDATE UserData SET CurrencySavePath = ? WHERE MayhemId = ?", [savePath, landId]);
      }

      await ensureCurrencyFile(landId, savePath, config.startingDonuts);

      const decodedMessage = ExtraLandMessage.decode(req.body);
      const currencyFile = await fsp.readFile(userData.CurrencySavePath);
      const decodedCurrencyData = CurrencyData.decode(currencyFile);

      let donutDelta = 0;
      const processedCurrencyDelta = decodedMessage.currencyDelta.map(cd => {
        donutDelta += cd.amount;
        return CurrencyDelta.create({ id: cd.id });
      });

      const newTotal = Number(decodedCurrencyData.vcTotalAwarded) + donutDelta;
      let newContent = CurrencyData.create({
        id: decodedCurrencyData.id,
        vcTotalPurchased: Number(decodedCurrencyData.vcTotalPurchased),
        vcTotalAwarded: newTotal,
        vcBalance: newTotal,
        createdAt: 1715911362,
        updatedAt: Date.now(),
      });

      fs.writeFileSync(userData.CurrencySavePath, CurrencyData.encode(newContent).finish());

      // Update session activity on currency update
      if (userData.UserId) {
        sessionManager.updateActivity(userData.UserId.toString());
      }

      let message = ExtraLandResponse.create({
        processedCurrencyDelta: processedCurrencyDelta,
        processedEvent: [],
        receivedEvent: [],
        communityGoal: [],
      });

      res.type("application/x-protobuf");
      res.send(ExtraLandResponse.encode(message).finish());
    } catch (error) {
      next(error);
    }
  },
);

export default router;
