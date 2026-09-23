import dotenv from "dotenv";
import mongoose from "mongoose";
import assert from "node:assert/strict";
import request from "supertest";
import { connectDatabase } from "../config/database.js";
import { createApp } from "../app.js";
dotenv.config({ quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });
try {
  await connectDatabase();
  const app = createApp();
  for (const [account, role, password] of [["customer", "user", "Demo@123"], ["photographer", "creator", "Demo@123"], ["makeup", "creator", "Demo@123"], ["admin", "admin", "Admin@123"], ["superadmin", "super_admin", "Admin@123"]]) {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: `${account}@memooria.demo`, password }).expect(200);
    assert.equal(login.body.role, role);
    await agent.get("/api/auth/me").expect(200);
    await agent.get(role === "admin" || role === "super_admin" ? "/api/admin/marketplace/metrics" : "/api/workspace").expect(200);
    console.log(`${account}: cookie login and authorized dashboard passed`);
  }
  const events = await request(app).get("/api/events").expect(200);
  const creators = await request(app).get("/api/creators?limit=60").expect(200);
  assert.ok(events.body.length >= 12); assert.ok(creators.body.items.length >= 2);
  for (const c of creators.body.items) { assert.equal(c.email, undefined); assert.equal(c.phone, undefined); assert.equal(c.application, undefined); }
  console.log(`Live read-only smoke passed: ${events.body.length} event types, ${creators.body.items.length} public creators; no contact leakage.`);
} finally { await mongoose.disconnect(); }
