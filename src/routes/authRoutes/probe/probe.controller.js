import { Router } from "express";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    res.status(200).send(""); // Send empty response, as thats what the client expects
  } catch (error) {
    next(error);
  }
});

export default router;
