import { Router, json } from "express";

import config from "../../../../config.json" with { type: "json" };

const router = Router();

router.use(json());

// -- General -- \\

router.get("/general/statistics", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      res.json({
        status: global.running ? "Online" : "Offline",
        uptime: process.uptime(),
        connectedUsers: "Soon...",
      });
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/general/start", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      global.running = true;
      res.status(200).send("Started Server");
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/general/stop", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      global.running = false;
      res.status(200).send("Stopped Server");
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

// -- Event -- \\

router.post("/event/set", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      const { timestamp } = req.body;
      global.lobbyTime = timestamp;

      res.status(200).send("Changed Event");
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

router.get("/event/get", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      res.json({
        lobbyTime: global.lobbyTime,
      });
    } else {
      res.status(401).send("Invalid or Empty Key");
    }
  } catch (error) {
    next(error);
  }
});

export default router;
