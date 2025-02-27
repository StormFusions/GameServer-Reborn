import { Router } from "express";

const router = Router();

router.post("/core/logEvent", async (req, res, next) => {
  try {
    res.status(200).send({ status: "ok" }); // Ignore the request, but make the client know we received it
  } catch (error) {
    next(error);
  }
});

export default router;
