import { Router } from "express";
import fileCache from "../../../lib/fileCache.js";
import path from "path";
import pb from "../../../lib/protobuf.js";
import { logger } from "../../../lib/logger.js";

// Import sub-controllers
import landRouter from "./land.controller.js";
import eventRouter from "./event.controller.js";
import currencyRouter from "./currency.controller.js";
import friendsRouter from "./friends.controller.js";
import trackingRouter from "./tracking.controller.js";
import invitationsRouter from "./invitations.controller.js";
import adminRouter from "./admin.controller.js";

const router = Router();

const LOBBY_TIME_XML = (timestamp) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Time><epochMilliseconds>${timestamp}</epochMilliseconds></Time>`;

// Core endpoints
router.get("/lobby/time", async (req, res, next) => {
  try {
    const timestamp = global.lobbyTime === 0 ? Math.floor(new Date().getTime()) : global.lobbyTime;
    res.type("application/xml").set("Cache-Control", "no-cache").send(LOBBY_TIME_XML(timestamp));
  } catch (error) {
    next(error);
  }
});

router.get("/bg_gameserver_plugin/protoClientConfig/", async (req, res, next) => {
  try {
    const ClientConfigResponse = pb.lookupType("Data.ClientConfigResponse");
    const clientConfigJSON = await fileCache.getJson(path.resolve("configs/ClientConfig.json"));
    const message = ClientConfigResponse.create(clientConfigJSON);
    const encoded = ClientConfigResponse.encode(message).finish();

    res.set("Cache-Control", "public, max-age=3600").type("application/x-protobuf").send(encoded);
  } catch (error) {
    next(error);
  }
});

// Mount sub-controllers
// Admin routes must be mounted BEFORE friends routes to avoid catch-all
router.use(adminRouter);
router.use(eventRouter);
router.use(landRouter);
router.use(currencyRouter);
router.use(friendsRouter);
router.use(trackingRouter);
router.use(invitationsRouter);

export default router;
