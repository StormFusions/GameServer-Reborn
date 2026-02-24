import { Router } from "express";
import fetch from "node-fetch";
import { logger } from "../../../lib/logger.js";

const router = Router();

// Proxy all requests to the original EA servers and log the responses
router.all("*", async (req, res, next) => {
  try {
    // Build the original EA URL based on the request path and query
    const originalBaseUrl = "https://prod.simpsons-ea.com";
    const path = req.path;
    const queryString = Object.keys(req.query).length > 0 
      ? "?" + new URLSearchParams(req.query).toString()
      : "";
    
    const fullUrl = `${originalBaseUrl}${path}${queryString}`;

    logger.info({
      method: req.method,
      path: path,
      fullUrl: fullUrl,
      headers: req.headers,
      body: req.body
    }, "PROXY REQUEST TO EA SERVER");

    // Forward the request to EA
    const proxyResponse = await fetch(fullUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        "host": "prod.simpsons-ea.com"
      },
      body: req.method !== "GET" && req.method !== "HEAD" 
        ? JSON.stringify(req.body)
        : undefined
    });

    // Get the response body
    const responseBody = await proxyResponse.text();
    const responseHeaders = Object.fromEntries(proxyResponse.headers);

    logger.info({
      method: req.method,
      path: path,
      statusCode: proxyResponse.status,
      headers: responseHeaders,
      body: responseBody.substring(0, 500)
    }, "PROXY RESPONSE FROM EA SERVER");

    // Send response back to game with the same format
    res.status(proxyResponse.status);
    Object.entries(responseHeaders).forEach(([key, value]) => {
      res.set(key, value);
    });
    res.send(responseBody);

  } catch (error) {
    logger.error({
      error: error.message,
      path: req.path,
      method: req.method
    }, "PROXY ERROR - EA SERVER UNREACHABLE");
    
    res.status(503).json({
      error: "EA Server unreachable",
      details: error.message
    });
  }
});

export default router;
