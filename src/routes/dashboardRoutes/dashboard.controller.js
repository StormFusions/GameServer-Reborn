import { Router, static as express_static, json } from "express";

import cookieParser from "cookie-parser";

import apiController from "./api/api.controller.js";

import config from "../../../config.json" with { type: "json" };

const router = Router();

router.use("/assets", express_static("./src/routes/dashboardRoutes/assets"));

router.use(cookieParser());
router.use(json());

router.use("/api", apiController);

router.get("/", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      res.render("admin-dashboard/dashboard");
    } else {
      res.render("admin-dashboard/login");
    }
  } catch (error) {
    next(error);
  }
});

router.get("/event", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      res.render("admin-dashboard/dashboard-event");
    } else {
      res.render("admin-dashboard/login");
    }
  } catch (error) {
    next(error);
  }
});

router.get("/users", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      res.render("admin-dashboard/dashboard-users");
    } else {
      res.render("admin-dashboard/login");
    }
  } catch (error) {
    next(error);
  }
});

router.get("/savefiles", async (req, res, next) => {
  try {
    const key = req.cookies.adminKey;
    if (key && key === config.adminKey) {
      res.render("admin-dashboard/dashboard-savefiles");
    } else {
      res.render("admin-dashboard/login");
    }
  } catch (error) {
    next(error);
  }
});


router.post("/login", async (req, res, next) => {
  try {
    const { key } = req.body;

    if (key == config.adminKey) {
      res.cookie("adminKey", key, {
        httpOnly: true, // Prevent client-side JS from accessing the cookie
        sameSite: "Strict",
        maxAge: 1728000000, // 48 hours
      });

      res.status(200).send("Valid Key");
    } else {
      res.status(401).send("Invalid Key");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    res.clearCookie("adminKey");
    res.status(200).send("Logged you out");
  } catch (error) {
    next(error);
  }
});

export default router;
