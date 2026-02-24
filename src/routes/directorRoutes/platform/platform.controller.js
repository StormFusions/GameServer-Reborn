import { Router } from "express";

import fs from "fs";
import fsp from "fs/promises";
import fileCache from "../../../lib/fileCache.js";
import path from "path";

import config from "../../../../config.json" with { type: "json" };

const router = Router();

async function getDirectionContent(packageId, platform) {
  let returnContent = {};
  try {
    returnContent = await fileCache.getJson(path.resolve(`directions/com.ea.game.simpsons4_row.json`));

    returnContent.clientId = `simpsons4-${platform}-client`;
    returnContent.mdmAppKey = `simpsons-4-${platform}`;

    returnContent.serverData.forEach((item) => {
      item.value = `http://${config.ip}:${config.listenPort}`;
    });
  } catch (error) {
    if (error.code == "ENOENT") {
      return { message: "Could not find that packageId" };
    } else {
      throw error;
    } // Throw the error if it's not file not found as it unrelated
  }

  return returnContent;
}

router.get("/:platform/getDirectionByPackage", async (req, res, next) => {
  // Android
  try {
    const packageId = req.query.packageId;
    if (!packageId) {
      res.status(400).send("Error 400: No packageId");
      return;
    }

    res.type("application/json");
    res.send(await getDirectionContent(packageId, req.params.platform));
  } catch (error) {
    next(error);
  }
});

router.get("/:platform/getDirectionByBundle", async (req, res, next) => {
  // iOS
  try {
    const bundleId = req.query.bundleId;
    if (!bundleId) {
      res.status(400).send("Error 400: No bundleId");
      return;
    }

    res.type("application/json");
    res.send(await getDirectionContent(bundleId, req.params.platform));
  } catch (error) {
    next(error);
  }
});

export default router;
