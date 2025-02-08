import { Router } from "express";
import fs from "fs";

const router = Router();

async function getDirectionContent(packageId, platform) {
  let returnContent = {};
  try {
    returnContent = JSON.parse(
      fs.readFileSync(`directions/${packageId}.json`, "utf8"),
    );

    returnContent.clientId = `simpsons4-${platform}-client`;
    returnContent.mdmAppKey = `simpsons-4-${platform}`;
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
  // Android
  try {
    const packageId = req.query.bundleId;
    if (!packageId) {
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
