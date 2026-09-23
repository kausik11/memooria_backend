import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { Creator, User, Review } from "../models/index.js";
import { Asset, Conversation, Message, Proposal, Booking, Delivery, Appeal, Dispute, Notification, SavedCreator, Project, Requirement } from "../models/marketplace.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { id } from "./bookings.js";
import { bookingFor, contactUnlocked, ownCreator, checkAssets, privateBookingStatuses, confirmedStatuses, eligible } from "../services/marketplace.js";
import { fail, isAdmin, moderate, settings, notify, audit, publicCreator } from "../services/platform.js";
import { uploadFile, privateLink } from "../services/storage.js";
export const workspaceRouter = Router();
workspaceRouter.use(["/assets", "/conversations", "/deliveries", "/appeals", "/disputes", "/notifications", "/saved", "/workspace"], authenticate);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
workspaceRouter.post("/assets", rateLimit({ windowMs: 3600000, limit: 60 }), upload.single("file"), async (req, res) => {
  if (!req.file) fail(400, "Choose a file.");
  const { purpose, context = "", contextId = "", linkedPortfolioItem = "" } = req.body;
  if (!["verification", "reference", "delivery", "portfolio", "appeal", "project"].includes(purpose)) fail(400, "Invalid file purpose.");
  const ext = req.file.originalname.split(".").pop().toLowerCase();
  const images = ["jpg", "jpeg", "png", "webp"], raw = ["cr2", "cr3", "nef", "arw", "raf", "orf", "rw2", "dng"], videos = ["mp4", "mov", "mxf"];
  if (![...images, ...videos, "pdf", ...(purpose === "verification" ? raw : [])].includes(ext)) fail(400, "Unsupported file extension.");
  if (images.includes(ext) && !["image/jpeg", "image/png", "image/webp"].includes(req.file.mimetype)) fail(400, "Invalid image type.");
  if (req.file.size > (await settings()).allowedUploadSizes * 1024 * 1024) fail(400, "File exceeds the platform upload limit.");
  if (purpose === "portfolio") await ownCreator(req.user, false);
  if (["delivery", "project"].includes(purpose)) { const b = await bookingFor(req.user, contextId); if (!confirmedStatuses.includes(b.status)) fail(409, "Confirm the booking before uploading project files."); if (purpose === "delivery" && String(b.creatorUser) !== req.user.id) fail(403, "Only the booked creator can deliver files."); }
  const meta = await uploadFile(req.file, `memooria/creators/${req.user.id}/${purpose}`, purpose !== "portfolio");
  const asset = await Asset.create({ ...meta, owner: req.user._id, purpose, context, contextId, linkedPortfolioItem, visibility: purpose === "portfolio" ? "PUBLIC" : purpose === "verification" ? "ADMIN" : "BOOKED_PARTIES" });
  const out = asset.toObject(); delete out.publicId; res.status(201).json(out);
});
workspaceRouter.get("/assets", async (req, res) => res.json(await Asset.find(isAdmin(req.user) && req.query.owner ? { owner: req.query.owner } : { owner: req.user._id }).sort({ createdAt: -1 }).lean()));
workspaceRouter.get("/assets/:id/access", async (req, res) => {
  const a = await Asset.findById(req.params.id).select("+publicId"); if (!a) fail(404, "File not found.");
  let allowed = isAdmin(req.user) || (a.purpose !== "verification" && String(a.owner) === req.user.id);
  if (!allowed && ["delivery", "project"].includes(a.purpose) && a.contextId) { await bookingFor(req.user, a.contextId); allowed = true; }
  if (!allowed && a.purpose === "reference") { const b = await Booking.findOne({ attachments: a._id, $or: [{ customer: req.user._id }, { creatorUser: req.user._id }] }); if (b && await contactUnlocked(b)) allowed = true; }
  if (!allowed) fail(403, "You cannot access this private file.");
  res.set("Cache-Control", "no-store").json({ url: a.url || privateLink(a) });
});
async function conversationFor(user, id) { const c = await Conversation.findById(id); if (!c || (!isAdmin(user) && !c.participants.some(p => String(p) === user.id))) fail(404, "Conversation not found."); return c; }
workspaceRouter.post("/conversations", validate(z.object({ context: z.enum(["BOOKING", "PROPOSAL", "GENERAL_INQUIRY", "SUPPORT"]), entityId: id.optional() })), async (req, res) => {
  const { context, entityId } = req.body; let participants, title;
  if (context === "BOOKING") { const b = await bookingFor(req.user, entityId); if (privateBookingStatuses.includes(b.status)) fail(409, "Admin must approve this booking first."); participants = [b.customer, b.creatorUser]; title = b.title; }
  else if (context === "PROPOSAL") { const p = await Proposal.findById(entityId); if (!p) fail(404, "Proposal not found."); const c = await Creator.findById(p.creator); participants = [p.customer, c.user]; if (!participants.some(p => String(p) === req.user.id) && !isAdmin(req.user)) fail(403, "Not your proposal."); title = "Proposal discussion"; }
  else if (context === "GENERAL_INQUIRY") { const c = await Creator.findById(entityId); if (!c?.user || c.status !== "Active" || !c.verified) fail(404, "Creator not found."); participants = [req.user._id, c.user]; title = `Question for ${c.businessName}`; }
  else { const admins = await User.find({ role: { $in: ["admin", "super_admin"] }, status: "ACTIVE" }).select("_id"); participants = [req.user._id, ...admins.map(a => a._id)]; title = "Memooria support"; }
  const key = `${context}:${entityId || req.user.id}${context === "GENERAL_INQUIRY" ? `:${req.user.id}` : ""}`;
  res.json(await Conversation.findOneAndUpdate({ key }, { $setOnInsert: { context, entityId, participants, title } }, { upsert: true, new: true }));
});
workspaceRouter.get("/conversations", async (req, res) => { const rows = await Conversation.find(isAdmin(req.user) ? {} : { participants: req.user._id }).sort({ updatedAt: -1 }).lean(); res.json(rows.map(c => ({ ...c, title: isAdmin(req.user) ? c.title : moderate(c.title) }))); });
workspaceRouter.get("/conversations/:id/messages", async (req, res) => { const c = await conversationFor(req.user, req.params.id); await Conversation.updateOne({ _id: c._id }, { $set: { [`readAt.${req.user.id}`]: new Date() } }); res.json(await Message.find({ conversation: c._id }).select(isAdmin(req.user) ? "+original" : "").sort({ createdAt: 1 }).limit(500).lean()); });
workspaceRouter.post("/conversations/:id/messages", validate(z.object({ text: z.string().trim().min(1).max(5000), attachments: z.array(id).max(20).default([]) })), async (req, res) => {
  const c = await conversationFor(req.user, req.params.id);
  let unlocked = false;
  if (c.context === "BOOKING") { const b = await bookingFor(req.user, c.entityId); unlocked = await contactUnlocked(b); }
  if (req.body.attachments.length) {
    if (!unlocked) fail(409, "Attachments are available after contact unlock in a confirmed booking conversation.");
    await checkAssets(req.body.attachments, req.user, "project");
    if (await Asset.countDocuments({ _id: { $in: req.body.attachments }, contextId: c.entityId }) !== new Set(req.body.attachments).size) fail(400, "Files must belong to this project.");
  }
  const text = unlocked ? req.body.text : moderate(req.body.text, (await settings()).blockMessageUrls);
  const m = await Message.create({ conversation: c._id, sender: req.user._id, original: req.body.text, text, moderated: text !== req.body.text, attachments: req.body.attachments });
  await Conversation.updateOne({ _id: c._id }, { $set: { updatedAt: new Date() } });
  for (const p of c.participants.filter(p => String(p) !== req.user.id)) await notify(p, "New message", "/customer/messages");
  const out = m.toObject(); delete out.original; res.status(201).json(out);
});
workspaceRouter.get("/deliveries", async (req, res) => { const bookings = await Booking.find(isAdmin(req.user) ? {} : { $or: [{ customer: req.user._id }, { creatorUser: req.user._id }] }).select("_id"); res.json(await Delivery.find({ booking: { $in: bookings.map(b => b._id) }, ...(req.query.booking && { booking: { $in: bookings.map(b => b._id).filter(id => String(id) === req.query.booking) } }) }).sort({ createdAt: -1 }).lean()); });
workspaceRouter.post("/deliveries", validate(z.object({ booking: id, title: z.string().trim().min(1).max(200), description: z.string().max(5000), album: z.string().max(100).default(""), files: z.array(id).min(1).max(100) })), async (req, res) => {
  const b = await bookingFor(req.user, req.body.booking); if (String(b.creatorUser) !== req.user.id || !["CONFIRMED", "IN_PROGRESS", "AWAITING_DELIVERY", "REVISION_REQUESTED", "DELIVERED"].includes(b.status)) fail(403, "This booking cannot receive deliveries.");
  await checkAssets(req.body.files, req.user, "delivery");
  if (await Asset.countDocuments({ _id: { $in: req.body.files }, contextId: String(b._id) }) !== new Set(req.body.files).size) fail(400, "Files must belong to this booking.");
  const delivery = await Delivery.create({ ...req.body, creatorUser: req.user._id, version: await Delivery.countDocuments({ booking: b._id }) + 1 });
  b.status = "DELIVERED"; b.history.push({ status: b.status, actor: req.user._id, at: new Date(), delivery: delivery._id }); await b.save(); await notify(b.customer, "New delivery ready to review", `/customer/bookings/${b._id}`); res.status(201).json(delivery);
});
workspaceRouter.post("/deliveries/:id/review", validate(z.object({ action: z.enum(["approve", "revision"]), comment: z.string().max(3000).default(""), timestamp: z.string().max(30).default("") })), async (req, res) => {
  const d = await Delivery.findById(req.params.id); if (!d) fail(404, "Delivery not found."); const b = await bookingFor(req.user, d.booking); if (String(b.customer) !== req.user.id) fail(403, "Only the customer can review a delivery.");
  if (!["DELIVERED", "REVISION_REQUESTED"].includes(b.status) || d.status === "APPROVED") fail(409, "Delivery is already closed.");
  if (req.body.action === "revision" && !req.body.comment.trim()) fail(400, "Describe the requested changes.");
  d.status = req.body.action === "approve" ? "APPROVED" : "REVISION_REQUESTED"; d.revisions.push({ comment: req.body.comment, timestamp: req.body.timestamp, user: req.user._id, createdAt: new Date() }); await d.save();
  b.status = req.body.action === "approve" ? "DELIVERED" : "REVISION_REQUESTED"; b.history.push({ status: b.status, actor: req.user._id, at: new Date(), note: req.body.comment }); await b.save(); await notify(b.creatorUser, `Delivery ${d.status}`, `/creator/bookings/${b._id}`); res.json(d);
});
for (const [path, Model] of [["appeals", Appeal], ["disputes", Dispute]]) {
  workspaceRouter.get(`/${path}`, async (req, res) => res.json(await Model.find(isAdmin(req.user) ? {} : { user: req.user._id }).sort({ createdAt: -1 }).lean()));
  workspaceRouter.post(`/${path}/:id/review`, validate(z.object({ status: z.enum(["UNDER_REVIEW", "MORE_INFO_REQUIRED", "APPROVED", "REJECTED", "CLOSED"]), reason: z.string().trim().min(3).max(5000) })), async (req, res) => {
    if (!isAdmin(req.user)) fail(403, "Administrator access required."); const item = await Model.findById(req.params.id); if (!item) fail(404, "Record not found."); const previous = item.status;
    item.status = req.body.status; if (path === "appeals") { item.decision = req.body.reason; item.history.push({ status: item.status, reason: item.decision, actor: req.user._id, at: new Date() }); if (item.status === "APPROVED") await Creator.updateOne({ _id: item.creator }, { $set: { status: "Active", verified: true, applicationStatus: "APPROVED", reviewReason: item.decision } }); } else item.resolution = req.body.reason;
    await item.save(); await audit(req.user, `${path.toUpperCase()}_REVIEW`, path, item._id, { status: previous }, req.body); await notify(item.user, `${path}: ${item.status}`, `/creator/${path}`); res.json(item);
  });
}
workspaceRouter.post("/appeals", validate(z.object({ reason: z.string().min(3).max(200), explanation: z.string().min(20).max(5000), files: z.array(id).max(20).default([]) })), async (req, res) => {
  const c = await ownCreator(req.user, false); if (!["REJECTED", "SUSPENDED", "RESTRICTED", "MORE_INFO_REQUIRED"].includes(c.applicationStatus)) fail(409, "Your application is not eligible for an appeal.");
  if (await Appeal.exists({ user: req.user._id, status: { $in: ["SUBMITTED", "UNDER_REVIEW"] } })) fail(409, "Your appeal is already being reviewed."); await checkAssets(req.body.files, req.user, "appeal"); res.status(201).json(await Appeal.create({ ...req.body, creator: c._id, user: req.user._id }));
});
workspaceRouter.post("/disputes", validate(z.object({ booking: id, reason: z.string().min(20).max(5000), files: z.array(id).max(20).default([]) })), async (req, res) => {
  const b = await bookingFor(req.user, req.body.booking); if (!confirmedStatuses.includes(b.status)) fail(409, "Only confirmed bookings can be disputed."); await checkAssets(req.body.files, req.user); const d = await Dispute.create({ ...req.body, user: req.user._id }); b.status = "DISPUTED"; b.history.push({ status: b.status, actor: req.user._id, at: new Date(), reason: req.body.reason }); await b.save(); res.status(201).json(d);
});
workspaceRouter.get("/notifications", async (req, res) => res.json(await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100).lean()));
workspaceRouter.patch("/notifications/:id", async (req, res) => { const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { read: true }, { new: true }); if (!n) fail(404, "Notification not found."); res.json(n); });
workspaceRouter.get("/saved", async (req, res) => { const rows = await SavedCreator.find({ user: req.user._id }).populate("creator").lean(); res.json(rows.filter(r => r.creator?.status === "Active" && r.creator.verified).map(r => publicCreator(r.creator))); });
workspaceRouter.put("/saved/:id", async (req, res) => { if (!await Creator.exists({ _id: req.params.id, status: "Active", verified: true })) fail(404, "Creator not found."); await SavedCreator.findOneAndUpdate({ user: req.user._id, creator: req.params.id }, {}, { upsert: true }); res.json({ ok: true }); });
workspaceRouter.delete("/saved/:id", async (req, res) => { await SavedCreator.deleteOne({ user: req.user._id, creator: req.params.id }); res.json({ ok: true }); });
workspaceRouter.get("/workspace", async (req, res) => {
  if (req.query.role === "creator") {
    const c = await Creator.findOne({ user: req.user._id });
    if (!c) return res.json({ profileViews: 0, bookingRequests: 0, proposalsSent: 0, completedJobs: 0 });
    const opportunities = await Requirement.find({ status: "PUBLISHED", deadline: { $gte: new Date().toISOString().slice(0, 10) } });
    const [bookingRequests, proposalsSent, acceptedProposals, upcomingBookings, completedJobs] = await Promise.all([
      Booking.countDocuments({ creator: c._id, status: { $nin: privateBookingStatuses } }), Proposal.countDocuments({ creator: c._id }), Proposal.countDocuments({ creator: c._id, status: "ACCEPTED" }), Booking.countDocuments({ creator: c._id, status: "CONFIRMED", date: { $gte: new Date().toISOString().slice(0, 10) } }), Booking.countDocuments({ creator: c._id, status: "COMPLETED" }),
    ]);
    return res.json({ profileViews: c.profileViews || 0, bookingRequests, requirementsMatched: opportunities.filter(r => eligible(c, r)).length, proposalsSent, acceptedProposals, upcomingBookings, completedJobs, averageRating: c.rating });
  }
  const [bookings, requirements, proposals, notifications] = await Promise.all([Booking.countDocuments({ customer: req.user._id }), Requirement.countDocuments({ customer: req.user._id }), Proposal.countDocuments({ customer: req.user._id }), Notification.countDocuments({ user: req.user._id, read: false })]);
  res.json({ bookings, requirements, proposals, notifications });
});
