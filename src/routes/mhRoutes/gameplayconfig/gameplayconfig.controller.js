import { Router } from "express";

import protobuf from "protobufjs";
import fs from "fs";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const root = await protobuf.load("TappedOut.proto");
    const GameplayConfigResponse = root.lookupType(
      "Data.GameplayConfigResponse",
    );

    const gameplayConfigJSON = JSON.parse(
      fs.readFileSync("configs/GameplayConfig.json"),
    );
    let message = GameplayConfigResponse.create(gameplayConfigJSON);

    res.type("application/x-protobuf"); // Make sure the client knows it's protobuf
    res.send(GameplayConfigResponse.encode(message).finish());
  } catch (error) {
    next(error);
  }
});

export default router;
