import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "../app.js";
import { User, Creator, Inquiry, Review } from "../models/index.js";
let db, app, admin, user, creator;
const available = "2099-12-20";
before(async () => {
  process.env.JWT_SECRET = "integration-test-secret-at-least-32-characters";
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  app = createApp();
  await User.create({
    name: "Admin",
    email: "admin@test.example",
    password: await bcrypt.hash("test-password-123", 4),
    role: "admin",
  });
  admin = request.agent(app);
  await admin
    .post("/api/auth/login")
    .send({ email: "admin@test.example", password: "test-password-123" })
    .expect(200);
  user = request.agent(app);
  await user
    .post("/api/auth/register")
    .send({
      name: "Customer",
      email: "customer@test.example",
      password: "test-password-123",
      role: "admin",
    })
    .expect(201);
  creator = await Creator.create({
    businessName: "Test Studio",
    slug: "test-studio",
    category: "Photography",
    location: "Kolkata, India",
    city: "Kolkata",
    status: "Active",
    availability: [available],
    packages: [{ name: "Basic", price: 25000, description: "Test package" }],
  });
  await Creator.create({
    businessName: "Hidden Studio",
    slug: "hidden-studio",
    category: "Photography",
    location: "Kolkata",
    status: "Pending",
    availability: [available],
  });
});
after(async () => {
  await mongoose.disconnect();
  await db?.stop();
});
test("registration cannot grant admin; protected routes reject guests and users", async () => {
  await request(app).get("/api/admin/creators").expect(401);
  await user.get("/api/admin/creators").expect(403);
  const me = await user.get("/api/auth/me").expect(200);
  assert.equal(me.body.role, "user");
  assert.equal(me.body.password, undefined);
  await admin.get("/api/admin/dashboard").expect(200);
});
test("search combines location, availability, category and price; hides pending creators", async () => {
  const result = await request(app)
    .get(
      `/api/search?location=kolkata&date=${available}&category=Photography&maxPrice=30000`,
    )
    .expect(200);
  assert.equal(result.body.total, 1);
  assert.equal(result.body.items[0].slug, "test-studio");
  assert.equal(
    (await request(app).get("/api/search?maxPrice=20000")).body.total,
    0,
  );
  assert.equal(
    (await request(app).get("/api/search?date=2099-12-21")).body.total,
    0,
  );
  await request(app).get("/api/creators/hidden-studio").expect(404);
  await request(app).get("/api/search?date=2099-02-31").expect(400);
  await request(app).get("/api/search?limit=-1").expect(400);
});
test("inquiry persists and administrator updates status; unavailable dates are rejected", async () => {
  const payload = {
    name: "Customer",
    email: "customer@test.example",
    phone: "+91 9000012345",
    creator: String(creator._id),
    service: "Photography",
    date: available,
    message: "We would love to discuss our wedding photography.",
  };
  await request(app)
    .post("/api/inquiry")
    .send({ ...payload, date: "2099-12-21" })
    .expect(409);
  const result = await request(app)
    .post("/api/inquiry")
    .send(payload)
    .expect(201);
  assert.equal(result.body.status, "New");
  await user
    .patch(`/api/admin/inquiries/${result.body._id}`)
    .send({ status: "Completed" })
    .expect(403);
  await admin
    .patch(`/api/admin/inquiries/${result.body._id}`)
    .send({ status: "Contacted" })
    .expect(200);
  assert.equal((await Inquiry.findById(result.body._id)).status, "Contacted");
});
test("reviews remain private until approved and update aggregate ratings", async () => {
  const result = await user
    .post("/api/reviews")
    .send({
      creator: String(creator._id),
      rating: 4,
      comment: "A thoughtful, professional experience from start to finish.",
    })
    .expect(201);
  assert.equal(
    (await request(app).get("/api/creators/test-studio")).body.reviews.length,
    0,
  );
  await admin
    .patch(`/api/admin/reviews/${result.body._id}`)
    .send({ approved: true })
    .expect(200);
  const profile = (await request(app).get("/api/creators/test-studio")).body;
  assert.equal(profile.rating, 4);
  assert.equal(profile.reviewCount, 1);
  assert.equal(profile.reviews.length, 1);
  await admin
    .patch(`/api/admin/reviews/${result.body._id}`)
    .send({ approved: false })
    .expect(200);
  assert.equal((await Creator.findById(creator._id)).rating, 0);
});
test("untrusted origins, invalid login, injection and malformed JSON fail safely", async () => {
  await request(app)
    .post("/api/auth/logout")
    .set("Origin", "https://evil.example")
    .expect(403);
  await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@test.example", password: "wrong-password" })
    .expect(401);
  await request(app)
    .post("/api/auth/login")
    .send({ email: { $ne: null }, password: "wrong-password" })
    .expect(400);
  await request(app)
    .post("/api/inquiry")
    .set("Content-Type", "application/json")
    .send("{bad json")
    .expect(400);
  await request(app).get("/api/creators/not-found").expect(404);
});
test("admin creator CRUD validates fields and rejects missing records", async () => {
  const payload = {
    businessName: "New Studio",
    ownerName: "Owner",
    slug: "new-studio",
    profileImage: "",
    coverImage: "",
    email: "owner@test.example",
    phone: "9000012345",
    category: "Photography",
    location: "Delhi",
    city: "Delhi",
    state: "Delhi",
    description: "A professional studio for your important moments.",
    services: ["Photography"],
    gallery: [],
    packages: [{ name: "Basic", price: 1000, description: "Test" }],
    availability: [available],
    socialLinks: { instagram: "", facebook: "", website: "" },
    featured: false,
    status: "Active",
  };
  await admin
    .post("/api/admin/creator")
    .send({
      ...payload,
      socialLinks: { ...payload.socialLinks, website: "javascript:alert(1)" },
    })
    .expect(400);
  const item = await admin.post("/api/admin/creator").send(payload).expect(201);
  await admin
    .put(`/api/admin/creator/${item.body._id}`)
    .send({ ...payload, businessName: "Updated Studio" })
    .expect(200);
  assert.equal(
    (await Creator.findById(item.body._id)).businessName,
    "Updated Studio",
  );
  await admin.delete(`/api/admin/creator/${item.body._id}`).expect(200);
  await request(app).get("/api/creators/new-studio").expect(404);
  await admin.delete(`/api/admin/creator/${item.body._id}`).expect(404);
});
