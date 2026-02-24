import { Router, raw } from "express";
import pb from "../../../lib/protobuf.js";
import { logger } from "../../../lib/logger.js";

const router = Router();

const OK_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?><Resources><URI>OK</URI></Resources>`;

// POST trackinglog - log error messages from client (mostly ignored)
router.post(
  "/bg_gameserver_plugin/trackinglog",
  raw({ type: "application/x-protobuf", limit: "52428800" }),
  async (req, res, next) => {
    try {
      const ClientLogMessage = pb.lookupType("Data.ClientLogMessage");
      ClientLogMessage.decode(req.body); // Validate but don't log full message
      res.type("application/xml").send(OK_RESPONSE);
    } catch (error) {
      next(error);
    }
  },
);

// POST trackingmetrics - track client metrics (mostly ignored)
router.post("/bg_gameserver_plugin/trackingmetrics", async (req, res, next) => {
  try {
    res.type("application/xml").send(OK_RESPONSE);
  } catch (error) {
    next(error);
  }
});

export default router;
