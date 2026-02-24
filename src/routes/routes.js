import { Router } from "express";

import gamesController from "./mhRoutes/games/game.index.js";
import gameplayconfigController from "./mhRoutes/gameplayconfig/gameplayconfig.controller.js";
import usersController from "./mhRoutes/users/users.controller.js";
import userstatsController from "./mhRoutes/userstats/userstats.controller.js";
import linkController from "./mhRoutes/link/link.controller.js";
import clienttelemetryController from "./mhRoutes/clienttelemetry/clienttelemetry.controller.js";

import directorPlatformController from "./directorRoutes/platform/platform.controller.js";

import userPlatformController from "./userRoutes/platform/platform.controller.js";

import probeController from "./authRoutes/probe/probe.controller.js";
import connectController from "./authRoutes/connect/connect.controller.js";

import identityController from "./proxyRoutes/identity/identity.controller.js";

import friendsController from "./mhRoutes/games/friends.controller.js";
import invitationsController from "./mhRoutes/games/invitations.controller.js";

import trackingApiController from "./trackingRoutes/api/api.controller.js";

import dashboardController from "./dashboardRoutes/dashboard.controller.js";
import userdashController from "./dashboardRoutes/userdash.controller.js";

const serverStatusMiddleware = (req, res, next) => {
  if (req.originalUrl.startsWith("/dashboard")) {
    // Can't turn the server on again without the dashboard
    return next();
  }

  if (!global.running) {
    return res.status(503).send("<h1>503 Service Temporarily Unavailable</h1>");
  }
  next(); // If the server status is set to online
};

const apiMh = Router()
  .use("/games", gamesController)
  .use("/gameplayconfig", gameplayconfigController)
  .use("/users", usersController)
  .use("/userstats", userstatsController)
  .use("/link", linkController)
  .use("/clienttelemetry", clienttelemetryController);

const apiDirector = Router().use("/", directorPlatformController);

const apiUser = Router().use("/", userPlatformController);

const apiAuth = Router()
  .use("/probe", probeController)
  .use("/connect", connectController);

const apiProxy = Router().use("/identity", identityController);

const apiFriends = Router().use("/", friendsController);

const apiInvitations = Router().use("/", invitationsController);

const apiTrackingApi = Router().use("/", trackingApiController);

export default Router()
  .use(serverStatusMiddleware)
  .use("/mh", apiMh)
  .use("/director/api", apiDirector)
  .use("/user/api", apiUser)
  .use("/", apiAuth)
  .use("/proxy", apiProxy)
  .use("/friends", apiFriends)  // Mount both friends & invitations at /friends
  .use("/friends", apiInvitations)
  .use("/2/users", apiFriends)  // And at /2/users for game calls
  .use("/2/users", apiInvitations)
  .use(
    "//proxy",
    apiProxy,
  ) /* //proxy/identity/geoagerequirements?client_id=simpsons4-android-client  */
  .use("/tracking/api", apiTrackingApi)
  .use("/dashboard", dashboardController)
  .use("/userdash", userdashController);
