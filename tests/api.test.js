import { Booking } from "../models/marketplace.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "../app.js";
import { User, Creator, Inquiry, Review, Service, Onboarding } from "../models/index.js";
import { questions } from "../config/questions.js";
import { v2 as cloudinary } from "cloudinary";
import { Writable } from "node:stream";
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
    status: "Active", verified: true, applicationStatus: "APPROVED",
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

test("onboarding tailors questions and saves customer interests", async () => {
  await Service.create({ title: "Photography", slug: "photography" });
  await Service.create({ title: "Makeup Artist", slug: "makeup-artist" });
  const photo = await request(app).get("/api/onboarding/questions?kind=creator&service=Photography").expect(200);
  assert.ok(photo.body.questions.some(q => q.id === "cameraAvailable"));
  const makeup = await request(app).get("/api/onboarding/questions?kind=creator&service=Makeup%20Artist").expect(200);
  assert.ok(makeup.body.questions.some(q => q.id === "kit"));
  assert.ok(!makeup.body.questions.some(q => q.id === "cameraAvailable"));
  await request(app).post("/api/onboarding/submit").send({}).expect(401);
  await user.post("/api/onboarding/submit").send({ kind: "user", answers: { city: "Delhi", interests: ["Fake"], occasion: "Wedding" } }).expect(400);
  await user.post("/api/onboarding/submit").send({ kind: "user", answers: { city: "Delhi", interests: ["Photography"], occasion: "Wedding" } }).expect(200);
  const me = await user.get("/api/auth/me");
  assert.deepEqual(me.body.onboarding.interests, ["Photography"]);
});

test("creator uploads are scoped, ID is authenticated, submissions validate ownership and remain private", async () => {
  const applicant = request.agent(app);
  await applicant.post("/api/auth/register").send({ name: "Applicant", email: "applicant@test.example", password: "test-password-123" }).expect(201);
  const original = cloudinary.uploader.upload_stream;
  const secret = process.env.CLOUDINARY_API_SECRET;
  process.env.CLOUDINARY_API_SECRET = "test-only";
  const options = [];
  cloudinary.uploader.upload_stream = (opts, cb) => {
    options.push(opts);
    return new Writable({ write(chunk, enc, next) { next(); }, final(next) { cb(null, { public_id: `${opts.folder}/sample`, format: "png", secure_url: `https://res.cloudinary.com/test/image/upload/${opts.folder}/sample.png` }); next(); } });
  };
  try {
    const answers = {};
    for (const q of questions("creator", "Photography")) {
      answers[q.id] = q.type === "number" ? 100 : q.type === "checkbox" ? true : q.type === "select" ? q.options[0] : "Detailed answer for application review";
    }
    Object.assign(answers, { service: "Photography", experience: 5, phone: "+91 9000012345", portfolio: "", cameraAvailable: "No" });
    await applicant.post("/api/onboarding/submit").send({ kind: "creator", answers }).expect(400);
    for (const purpose of ["profileImage", "workSamples", "idCard"]) {
      const result = await applicant.post(`/api/onboarding/upload/${purpose}`).attach("image", Buffer.from("test image"), { filename: "sample.png", contentType: "image/png" }).expect(201);
      answers[purpose] = purpose === "workSamples" ? [result.body.value] : result.body.value;
    }
    assert.equal(options[2].type, "authenticated");
    assert.equal(options[0].folder.split("/")[2], options[2].folder.split("/")[2]);
    await applicant.put("/api/onboarding").send({ kind: "creator", answers }).expect(200);
    assert.equal((await applicant.get("/api/onboarding")).body.answers.service, "Photography");
    await applicant.post("/api/onboarding/submit").send({ kind: "creator", answers: { ...answers, profileImage: "https://res.cloudinary.com/other/image/upload/stolen.png" } }).expect(400);
    await applicant.post("/api/onboarding/submit").send({ kind: "creator", answers }).expect(201);
    await applicant.post("/api/onboarding/submit").send({ kind: "creator", answers }).expect(200);
    const c = await Creator.findOne({ email: "applicant@test.example" }).select("+application");
    assert.equal(c.status, "Pending");
    assert.equal(c.application.cameraModel, undefined);
    assert.ok(c.application.address);
    await request(app).get(`/api/creators/${c.slug}`).expect(404);
    await Creator.updateOne({ _id: c._id }, { $set: { status: "Active", verified: true, applicationStatus: "APPROVED" } });
    const publicProfile = await request(app).get(`/api/creators/${c.slug}`).expect(200);
    assert.equal(publicProfile.body.application, undefined);
    const listing = await request(app).get("/api/creators").expect(200);
    assert.ok(listing.body.items.every(item => !item.application));
    await applicant.get(`/api/admin/creator/${c._id}/identity`).expect(403);
    const review = await admin.get("/api/admin/creators").expect(200);
    assert.ok(review.body.find(item => item._id === String(c._id)).application);
    assert.equal(await Onboarding.countDocuments({ user: c.user }), 1);
    await request(app).get("/api/admin/onboarding").expect(401);
    await applicant.get("/api/admin/onboarding").expect(403);
    const registrations = await admin.get("/api/admin/onboarding").expect(200);
    const registration = registrations.body.find(r => r.email === "applicant@test.example");
    assert.equal(registration.password, undefined);
    assert.equal(registration.creator.application.address, answers.address);
    await applicant.patch(`/api/admin/onboarding/creators/${c._id}`).send({ answers: {}, status: "Active" }).expect(403);
    await admin.patch(`/api/admin/onboarding/creators/${c._id}`).send({ answers: { perDayRate: -1 }, status: "Active" }).expect(400);
    await admin.patch(`/api/admin/onboarding/creators/${c._id}`).send({ answers: { idCard: "replacement-id" }, status: "Active" }).expect(400);
    await admin.patch(`/api/admin/onboarding/creators/${c._id}`).send({ answers: { bio: "Updated biography reviewed by the administrator.", perDayRate: 2400, servingArea: "Delhi and nearby towns" }, status: "Inactive" }).expect(200);
    const edited = await Creator.findById(c._id).select("+application");
    assert.equal(edited.description, "Updated biography reviewed by the administrator.");
    assert.equal(edited.packages.find(p => p.name === "Per day").price, 2400);
    assert.equal(edited.status, "Inactive");
    assert.equal(edited.application.servingArea, "Delhi and nearby towns");
    assert.equal((await Onboarding.findOne({ user: c.user })).answers.perDayRate, 2400);
    await request(app).get(`/api/creators/${c.slug}`).expect(404);
    await admin.patch(`/api/admin/onboarding/users/${c.user}`).send({ name: "Updated Applicant", email: "updated-applicant@test.example", phone: "9000012345", city: "Delhi", interests: ["Photography"], occasion: "Wedding", role: "admin" }).expect(200);
    const account = await User.findById(c.user);
    assert.equal(account.name, "Updated Applicant");
    assert.equal(account.role, "creator");
    assert.deepEqual(account.onboarding.interests, ["Photography"]);
    await Creator.updateOne({ _id: c._id }, { $set: { status: "Pending" } });
  } finally {
    cloudinary.uploader.upload_stream = original;
    if (secret === undefined) delete process.env.CLOUDINARY_API_SECRET; else process.env.CLOUDINARY_API_SECRET = secret;
  }
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
  const reviewer = await User.findOne({ email: "customer@test.example" });
  await Booking.create({ customer: reviewer._id, creator: creator._id, creatorUser: reviewer._id, status: "COMPLETED" });
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
