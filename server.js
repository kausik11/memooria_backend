import "dotenv/config";
import dotenv from "dotenv";
import { connectDatabase } from "./config/database.js";
import { createApp } from "./app.js";
dotenv.config({ path: ".env.local", override: true });
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  throw new Error("JWT_SECRET must have at least 32 characters.");
await connectDatabase();
createApp().listen(process.env.PORT || 4000, () =>
  console.log(`Memooria API ready on port ${process.env.PORT || 4000}`),
);
