import { Router } from "express";

import pb from "../../../lib/protobuf.js";
import fileCache from "../../../lib/fileCache.js";
import path from "path";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const GameplayConfigResponse = pb.lookupType("Data.GameplayConfigResponse");

    const gameplayConfigJSON = await fileCache.getJson(path.resolve("configs/GameplayConfig.json"));
    let message = GameplayConfigResponse.create(gameplayConfigJSON);

    // Cache for 1 hour since config changes infrequently
    res.set("Cache-Control", "public, max-age=3600");
    res.type("application/x-protobuf");
    res.send(GameplayConfigResponse.encode(message).finish());
  } catch (error) {
    next(error);
  }
});

export default router;
