import mongoose from "mongoose";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export async function connectDatabase() {
  let uri = process.env.MONGODB_URI;
  if (
    !uri &&
    process.env.DEV_DATABASE === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const dbPath = fileURLToPath(new URL("../.data/", import.meta.url));
    await mkdir(dbPath, { recursive: true });
    const db = await MongoMemoryServer.create({
      instance: { port: 27019, dbPath, storageEngine: "wiredTiger" },
    });
    uri = db.getUri("memooria");
  }
  if (!uri) throw new Error("Set MONGODB_URI in backend/.env. See README.md.");
  await mongoose.connect(uri);
}
