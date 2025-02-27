import { Router } from "express";

import crypto from "crypto";

const router = Router();

function generateRandomDeviceId() {
  return crypto
    .createHash("sha256")
    .update(new Date().toString())
    .digest("hex");
}

router.get("/:platform/getDeviceID", async (req, res, next) => {
  try {
    res.type("application/json");
    res.send({
      deviceId: generateRandomDeviceId(), // Not important, so it can be random
      resultCode: 0,
      serverApiVersion: "1.0.0",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:platform/validateDeviceID", async (req, res, next) => {
  try {
    res.type("application/json");
    res.send({
      deviceId: req.query.eadeviceid,
      resultCode: 0,
      serverApiVersion: "1.0.0",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:platform/getAnonUid", async (req, res, next) => {
  try {
    res.type("application/json");
    res.send({
      resultCode: 0,
      serverApiVersion: "1.0.0",
      uid: 1000000000000, // This UID is not checked to be correct, so it's static for simplicity
    });
  } catch (error) {
    next(error);
  }
});

export default router;
