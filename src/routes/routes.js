import { Router } from "express";

import androidController from "./directorRoutes/android/android.controller.js";

import gamesController from "./mhRoutes/games/games.controller.js";
import gameplayconfigController from "./mhRoutes/gameplayconfig/gameplayconfig.controller.js";
import usersController from "./mhRoutes/users/users.controller.js";
import userstatsController from "./mhRoutes/userstats/userstats.controller.js";
import linkController from "./mhRoutes/link/link.controller.js";
import clienttelemetryController from "./mhRoutes/clienttelemetry/clienttelemetry.controller.js";

const apiMh = Router()
  .use("/games", gamesController)
  .use("/gameplayconfig", gameplayconfigController)
  .use("/users", usersController)
  .use("/userstats", userstatsController)
  .use("/link", linkController)
  .use("/clienttelemetry", clienttelemetryController);

const apiDirector = Router().use("/android", androidController);

export default Router().use("/mh", apiMh).use("/director/api", apiDirector);
