import { Router } from "express";
import fs from "fs";

const router = Router();

router.get("/getDirectionByPackage", async (req, res, next) => {
  try {
    const packageId = req.query.packageId;
    if (!packageId) {
      res.status(400).send("Error 400: No packageId");
      return;
    }

    let returnFile = "";
    try {
      returnFile = fs.readFileSync(`directions/${packageId}.json`, "utf8");
    } catch (error) {
      if (error.code == "ENOENT") {
        res.status(500).send("Could not find that packageId");
        return;
      } else {
        throw error;
      } // Throw the error if it's not file not found as it unrelated
    }

    res.type("application/json");
    res.send(returnFile);
  } catch (error) {
    next(error);
  }
});

export default router;
