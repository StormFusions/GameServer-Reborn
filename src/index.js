import express from "express";
import routes from "./routes/routes.js";

import compression from "compression";

import { debugWithTime } from "./util/debugUtil.js";

const app = express();
const PORT = process.env.PORT || 4242;

app.use((req, res, next) => {
  debugWithTime(`${req.method} ${req.originalUrl}`);
  next();
});

app.use(
  compression({
    filter: (req, res) => {
      return true; // Always compress the response
    },
    threshold: 0,
  }),
);
app.use(routes);

app.get("/", (req, res) => {
  res.send("Hello, World!");
});

app.use((req, res) => {
  res.status(404).send("Do'h! Error 404");
});

app.listen(PORT, () => {
  debugWithTime(`Listening on port ${PORT}`);
});
