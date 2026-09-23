import { Router } from "express";
import { z } from "zod";
import { Creator, User, Onboarding } from "../models/index.js";
import { Asset, Booking, Requirement, Appeal, Dispute } from "../models/marketplace.js";
import { authenticate, adminOnly } from "../middleware/auth.js";
import { validate, date, imageUrl, requiredImageUrl } from "../middleware/validate.js";
import { ownCreator, minute } from "../services/marketplace.js";
import { fail, audit, notify } from "../services/platform.js";
import { time } from "./bookings.js";
export const creatorWorkspaceRouter = Router();
creatorWorkspaceRouter.use("/creator-workspace", authenticate);
creatorWorkspaceRouter.get("/creator-workspace", async (req, res) => { const c = await Creator.findOne({ user: req.user._id }).select("+application"); if (!c) return res.json({ profile: null }); res.json({ profile: c, analytics: { profileViews: c.profileViews || 0, bookingRequests: await Booking.countDocuments({ creator: c._id, status: { $nin: ["PENDING_ADMIN_REVIEW", "ADMIN_REJECTED", "NEEDS_INFORMATION"] } }), completedJobs: await Booking.countDocuments({ creator: c._id, status: "COMPLETED" }) }, verification: await Asset.find({ owner: req.user._id, purpose: "verification" }).lean() }); });
const profileInput = z.object({ businessName: z.string().trim().min(1).max(200), description: z.string().min(20).max(10000), city: z.string().min(1).max(200), state: z.string().max(200), businessType: z.enum(["INDIVIDUAL", "STUDIO", "AGENCY", "RENTAL_PROVIDER", "VENUE_PROVIDER"]), languages: z.array(z.string().max(100)).max(30), experience: z.number().min(0).max(80), serviceAreas: z.array(z.string().max(200)).max(100), travelAvailable: z.boolean(), services: z.array(z.string().max(200)).max(40), eventTypes: z.array(z.string().max(200)).max(30), profileImage: imageUrl, coverImage: imageUrl, gallery: z.array(requiredImageUrl).max(100), packages: z.array(z.object({ name: z.string().min(1).max(200), price: z.number().min(0).max(10000000), description: z.string().max(3000), duration: z.string().max(200).optional(), deliveryTime: z.string().max(200).optional(), includedItems: z.array(z.string().max(500)).max(50).optional(), active: z.boolean().default(true) })).max(20) });
creatorWorkspaceRouter.put("/creator-workspace/profile", validate(profileInput), async (req, res) => {
  const c = await ownCreator(req.user, false);
  const previous = new Set([c.profileImage, c.coverImage, ...c.gallery]);
  const added = [...new Set([req.body.profileImage, req.body.coverImage, ...req.body.gallery].filter(url => url && !previous.has(url)))];
  if (added.length && await Asset.countDocuments({ owner: req.user._id, purpose: "portfolio", url: { $in: added } }) !== added.length) fail(400, "Use portfolio images uploaded through your own account.");
  Object.assign(c, req.body, { location: `${req.body.city}, ${req.body.state}` }); await c.save(); res.json(c);
});
creatorWorkspaceRouter.put("/creator-workspace/availability", validate(z.object({ availability: z.array(date).max(1000), weeklyHours: z.array(z.object({ weekday: z.number().int().min(0).max(6), startTime: time, endTime: time }).refine(v => v.startTime < v.endTime, "End time must follow start time")).max(21).default([]), timeSlots: z.array(z.object({ date, startTime: time, endTime: time, blocked: z.boolean() }).refine(v => v.startTime < v.endTime, "End time must follow start time")).max(1000), temporaryLocations: z.array(z.object({ city: z.string().min(1).max(200), from: date, until: date }).refine(v => v.from <= v.until, "Check location dates")).max(100) })), async (req, res) => { const c = await ownCreator(req.user, false); Object.assign(c, req.body); await c.save(); res.json(c); });
creatorWorkspaceRouter.post("/creator-workspace/verification", async (req, res) => {
  const c = await ownCreator(req.user, false); if (c.applicationStatus === "SUSPENDED") fail(409, "Submit an appeal for a suspended profile.");
  const assets = await Asset.find({ owner: req.user._id, purpose: "verification" });
  if (!assets.length) fail(400, "Upload verification evidence first.");
  if (c.category === "Photography" && (c.gallery.length < 10 || assets.filter(a => ["cr2", "cr3", "nef", "arw", "raf", "orf", "rw2", "dng"].includes(a.extension)).length < 3)) fail(400, "Photographers need at least 10 portfolio photos and 3 original RAW files.");
  c.verificationFiles = assets.map(a => String(a._id)); c.applicationStatus = "UNDER_REVIEW"; c.status = "Pending"; c.verified = false; c.reviewHistory.push({ status: "UNDER_REVIEW", at: new Date(), actor: req.user._id }); await c.save(); res.json(c);
});
creatorWorkspaceRouter.use("/admin/marketplace", authenticate, adminOnly);
creatorWorkspaceRouter.get("/admin/marketplace/metrics", async (req, res) => {
  const result = {}; for (const [key, Model, filter] of [["customers", User, { role: "user" }], ["creators", Creator, {}], ["pendingApplications", Creator, { applicationStatus: "UNDER_REVIEW" }], ["pendingRequirements", Requirement, { status: "PENDING_ADMIN_REVIEW" }], ["liveRequirements", Requirement, { status: "PUBLISHED" }], ["pendingBookings", Booking, { status: "PENDING_ADMIN_REVIEW" }], ["confirmedBookings", Booking, { status: "CONFIRMED" }], ["completedBookings", Booking, { status: "COMPLETED" }], ["openDisputes", Dispute, { status: "OPEN" }], ["pendingAppeals", Appeal, { status: "SUBMITTED" }]]) result[key] = await Model.countDocuments(filter); res.json(result);
});
creatorWorkspaceRouter.get("/admin/marketplace/applications", async (req, res) => res.json(await Creator.find({ user: { $exists: true } }).select("+application").sort({ createdAt: -1 }).lean()));
creatorWorkspaceRouter.post("/admin/marketplace/applications/:id/review", validate(z.object({ action: z.enum(["approve", "reject", "information", "suspend", "reactivate"]), reason: z.string().trim().max(3000).default("") })), async (req, res) => {
  const c = await Creator.findById(req.params.id); if (!c) fail(404, "Application not found.");
  if (["reject", "information", "suspend"].includes(req.body.action) && !req.body.reason) fail(400, "Give the creator a reason.");
  const before = c.applicationStatus;
  if (req.body.action === "approve") {
    const evidence = await Asset.countDocuments({ owner: c.user, purpose: "verification" });
    if (!evidence && !c.verified) fail(400, "Review uploaded verification evidence before approving.");
  }
  c.applicationStatus = { approve: "APPROVED", reject: "REJECTED", information: "MORE_INFO_REQUIRED", suspend: "SUSPENDED", reactivate: "APPROVED" }[req.body.action];
  if (req.body.action === "reactivate" && before !== "SUSPENDED") fail(409, "Only suspended profiles can be reactivated.");
  c.status = c.applicationStatus === "APPROVED" ? "Active" : c.applicationStatus === "MORE_INFO_REQUIRED" ? "Pending" : "Inactive";
  c.verified = c.applicationStatus === "APPROVED"; c.reviewReason = req.body.reason; c.reviewHistory.push({ status: c.applicationStatus, reason: req.body.reason, actor: req.user._id, at: new Date() }); await c.save();
  if (c.user) await User.updateOne({ _id: c.user, role: "user" }, { $set: { role: "creator" } });
  await audit(req.user, "CREATOR_REVIEW", "Creator", c._id, { status: before }, { status: c.applicationStatus, reason: c.reviewReason }); await notify(c.user, `Application: ${c.applicationStatus}`, "/creator/verification"); res.json(c);
});
