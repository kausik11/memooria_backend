import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { router } from "./routes/index.js";
export function createApp() {
  const app = express();
  const origins = (
    process.env.FRONTEND_ORIGINS ||
    "http://localhost:3000,http://localhost:3001"
  ).split(",");
  app.use(
    helmet(),
    cors({ origin: origins, credentials: true }),
    express.json({ limit: "1mb" }),
    cookieParser(),
  );
  app.use((req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      !origins.includes(req.headers.origin)
    )
      return res.status(403).json({ message: "Origin not allowed." });
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 200,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    router,
  );
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.use((req, res) =>
    res.status(404).json({ message: "Endpoint not found." }),
  );
  app.use((err, req, res, next) => {
    if (err.code === 11000)
      return res.status(409).json({
        message: "An entry with these unique details already exists.",
      });
    if (
      ["ValidationError", "CastError", "MulterError"].includes(err.name) ||
      err.type === "entity.parse.failed"
    )
      return res.status(400).json({
        message: "Invalid request. Check the supplied fields or image size.",
      });
    console.error(err.message);
    res
      .status(500)
      .json({ message: "Something went wrong. Please try again." });
  });
  return app;
}
