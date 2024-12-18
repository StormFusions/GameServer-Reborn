import { Router } from "express";

const router = Router();

router.post("/:MayhemId/users", async (req, res, next) => {
  try {
    const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                <Resources>
                        <URI>OK</URI>
                </Resources>`;

    res.type("application/xml"); // Make sure the client knows it's XML
    res.send(xmlResponse); // Ignore the request, because i don't know what it's used for yet
  } catch (error) {
    next(error);
  }
});

export default router;
