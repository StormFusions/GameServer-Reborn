import { Router, raw } from "express";
import fs from "fs";
import pb from "../../../lib/protobuf.js";
import { logger } from "../../../lib/logger.js";
import { v4 as uuidv4 } from "uuid";
import config from "../../../../config.json" with { type: "json" };
import { dbGet } from "../../../lib/db.js";

const router = Router();

// GET event protoland - retrieve pending events for owner
router.get("/bg_gameserver_plugin/event/:friendId/protoland/", async (req, res, next) => {
  const friendIdParam = req.params.friendId;
  
  try {
    const eventsFilePath = `${config.dataDirectory}/${friendIdParam}/${friendIdParam}.events`;
    
    if (fs.existsSync(eventsFilePath)) {
      try {
        const eventsData = fs.readFileSync(eventsFilePath);
        // Verify it's valid by decoding, but send raw bytes
        const EventsMessage = pb.lookupType("Data.EventsMessage");
        const decoded = EventsMessage.decode(eventsData);
        logger.info({ friendId: friendIdParam, eventCount: decoded.event?.length || 0 }, "✓ Loaded events");
        res.type("application/x-protobuf").send(eventsData);
        return;
      } catch (err) {
        logger.warn({ friendId: friendIdParam }, "Events file corrupted");
      }
    }

    // Return empty events
    const EventsMessage = pb.lookupType("Data.EventsMessage");
    const empty = EventsMessage.create({ event: [] });
    res.type("application/x-protobuf").send(EventsMessage.encode(empty).finish());
  } catch (error) {
    logger.error(error, "Error in GET event protoland");
    const EventsMessage = pb.lookupType("Data.EventsMessage");
    const empty = EventsMessage.create({ event: [] });
    res.type("application/x-protobuf").send(EventsMessage.encode(empty).finish());
  }
});

// POST event protoland - receive friend actions as EventMessage and store in .events file
router.post(
  "/bg_gameserver_plugin/event/:toPlayerId/protoland/",
  raw({ type: "application/x-protobuf", limit: "52428800" }),
  async (req, res, next) => {
    try {
      const toPlayerId = req.params.toPlayerId;
      const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];

      if (!reqToken) {
        res.type("application/xml").status(400).send(
          `<?xml version="1.0" encoding="UTF-8"?><error code="400" type="MISSING_VALUE" field="nucleus_token"/>`,
        );
        return;
      }

      // Parse event quickly - minimal processing
      const EventMessage = pb.lookupType("Data.EventMessage");
      let eventMessage;
      try {
        eventMessage = EventMessage.decode(req.body);
      } catch (err) {
        logger.warn({ err }, "Could not decode EventMessage");
        res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<WholeLandUpdateResponse/>`);
        return;
      }

      // Get actual owner - check if message has correct target, or use URL param
      const actualOwnerId = eventMessage.toPlayerId || toPlayerId;
      const visitorId = eventMessage.fromPlayerId || toPlayerId;
      const visitorName = (eventMessage.eventData && eventMessage.eventData.displayName) || "Visitor";

      // Set event metadata
      eventMessage.id = uuidv4();
      eventMessage.fromPlayerId = visitorId;
      eventMessage.toPlayerId = actualOwnerId;
      
      // Ensure displayName is set for client display
      if (!eventMessage.eventData) {
        eventMessage.eventData = {};
      }
      eventMessage.eventData.displayName = visitorName;
      eventMessage.eventData.displayNameLen = visitorName.length;

      // Save event to file quickly
      const playerDir = `${config.dataDirectory}/${actualOwnerId}`;
      if (!fs.existsSync(playerDir)) {
        fs.mkdirSync(playerDir, { recursive: true });
      }

      const eventsFilePath = `${playerDir}/${actualOwnerId}.events`;
      const EventsMessage = pb.lookupType("Data.EventsMessage");
      let eventsMessage = EventsMessage.create({ event: [] });

      // Load existing events if file exists
      if (fs.existsSync(eventsFilePath)) {
        try {
          const data = fs.readFileSync(eventsFilePath);
          const decoded = EventsMessage.decode(data);
          eventsMessage = decoded || EventsMessage.create({ event: [] });
        } catch (e) {
          // File corrupted, start fresh
          eventsMessage = EventsMessage.create({ event: [] });
        }
      }

      // Append and save
      if (!eventsMessage.event) eventsMessage.event = [];
      eventsMessage.event.push(eventMessage);
      
      const encoded = EventsMessage.encode(eventsMessage).finish();
      fs.writeFileSync(eventsFilePath, Buffer.from(encoded));
      logger.info({ owner: actualOwnerId, eventCount: eventsMessage.event.length }, "✓ Event saved");

      res.type("application/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<WholeLandUpdateResponse/>`);
    } catch (error) {
      logger.error(error, "Error processing POST event protoland");
      next(error);
    }
  },
);

// GET events only - retrieve pending friend events (using query param to differentiate from friend land endpoint)
router.get(
  "/bg_gameserver_plugin/event/:mayhemsId/protoland/",
  async (req, res, next) => {
    // Check if this is a request for events (has events query param) or for friend land data
    const isEventsRequest = req.query.events === "1" || req.query.events === "true";
    
    if (!isEventsRequest) {
      // Not an events request, pass to next handler (friend land endpoint)
      return next();
    }

    try {
      const mayhemsId = req.params.mayhemsId;
      const reqToken = req.headers["nucleus_token"] || req.headers["mh_auth_params"];

      if (!reqToken) {
        res.type("application/xml").status(400).send(
          `<?xml version="1.0" encoding="UTF-8"?><error code="400" type="MISSING_VALUE" field="nucleus_token"/>`,
        );
        return;
      }

      // Verify requesting user
      const userData = await dbGet("SELECT MayhemId FROM UserData WHERE MayhemId = ? AND UserAccessToken = ?", [mayhemsId, reqToken]);

      if (!userData) {
        logger.warn({ mayhemsId }, "Unauthorized events access");
        const EventsMessage = pb.lookupType("Data.EventsMessage");
        res.type("application/x-protobuf").send(EventsMessage.encode(EventsMessage.create({ event: [] })).finish());
        return;
      }

      const eventsFilePath = `${config.dataDirectory}/${mayhemsId}/${mayhemsId}.events`;

      if (!fs.existsSync(eventsFilePath)) {
        const EventsMessage = pb.lookupType("Data.EventsMessage");
        res.type("application/x-protobuf").send(EventsMessage.encode(EventsMessage.create({ event: [] })).finish());
        return;
      }

      try {
        const eventsData = fs.readFileSync(eventsFilePath);
        const EventsMessage = pb.lookupType("Data.EventsMessage");
        const decoded = EventsMessage.decode(eventsData);
        logger.info({ mayhemsId, eventCount: decoded.event?.length || 0 }, "✓ Returning events");
        res.type("application/x-protobuf").send(eventsData);
      } catch (err) {
        logger.error(err, "Error reading events file");
        const EventsMessage = pb.lookupType("Data.EventsMessage");
        res.type("application/x-protobuf").send(EventsMessage.encode(EventsMessage.create({ event: [] })).finish());
      }
    } catch (error) {
      logger.error(error, "Error processing GET event protoland");
      next(error);
    }
  },
);

// Clear events file after player saves their town
export async function clearEventsFile(mayhemsId) {
  try {
    const eventsFilePath = `${config.dataDirectory}/${mayhemsId}/${mayhemsId}.events`;
    if (fs.existsSync(eventsFilePath)) {
      fs.unlinkSync(eventsFilePath);
      logger.info({ mayhemsId }, "✓ Cleared events file after town save");
    }
  } catch (err) {
    logger.error({ err, mayhemsId }, "Error clearing events file");
  }
}

export default router;
