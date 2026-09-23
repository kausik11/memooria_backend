import { Router } from "express";
import { z } from "zod";
import { Creator, Service } from "../models/index.js";
import { Requirement, Proposal, Booking } from "../models/marketplace.js";
import { authenticate, adminOnly } from "../middleware/auth.js";
import { validate, futureDate } from "../middleware/validate.js";
import { eventInput, id } from "./bookings.js";
import { ownCreator, eligible, makeBooking, checkAssets } from "../services/marketplace.js";
import { isAdmin, fail, settings, notify, audit, moderate } from "../services/platform.js";
import { getFields, validateFields, validateFieldUploads } from "../services/forms.js";
export const requirementRouter = Router();
requirementRouter.use(["/requirements", "/proposals"], authenticate);
const published = ["PUBLISHED", "CLOSED_FOR_NEW_PROPOSALS", "BOOKED"];
async function access(user, id) {
  const r = await Requirement.findById(id).select("+venue"); if (!r) fail(404, "Requirement not found.");
  if (isAdmin(user) || String(r.customer) === user.id) return r;
  const c = await ownCreator(user);
  if (!published.includes(r.status) || !eligible(c, r)) fail(404, "Requirement not found.");
  return r;
}
function view(r, user) {
  const obj = r.toObject ? r.toObject() : { ...r };
  if (!isAdmin(user) && String(r.customer) !== user.id) { delete obj.customer; delete obj.venue; delete obj.answers; delete obj.attachments; delete obj.history; obj.description = moderate(obj.description); obj.instructions = moderate(obj.instructions); obj.title = moderate(obj.title); }
  return obj;
}
const input = eventInput.extend({ services: z.array(z.string().trim().min(1).max(200)).min(1).max(20), budgetMin: z.number().min(0).max(10000000), budgetMax: z.number().min(1).max(10000000), description: z.string().trim().min(20).max(10000), deadline: futureDate }).refine(v => v.startTime < v.endTime && v.budgetMin <= v.budgetMax && v.deadline <= v.date, "Check times, budget and proposal deadline");
requirementRouter.post("/requirements", validate(input), async (req, res) => {
  const services = await Service.distinct("title", { active: { $ne: false } }); if (req.body.services.some(s => !services.includes(s))) fail(400, "Choose active services.");
  await checkAssets(req.body.attachments, req.user, "reference");
  const answers = validateFields(await getFields("REQUIREMENT_FORM"), req.body.answers, services);
  await validateFieldUploads(await getFields("REQUIREMENT_FORM"), answers, req.user);
  const r = await Requirement.create({ ...req.body, services: [...new Set(req.body.services)], answers, customer: req.user._id, proposalLimit: (await settings()).proposalLimit, history: [{ status: "PENDING_ADMIN_REVIEW", at: new Date(), actor: req.user._id }] });
  res.status(201).json(r);
});
requirementRouter.get("/requirements", async (req, res) => {
  if (isAdmin(req.user)) return res.json(await Requirement.find().sort({ createdAt: -1 }).lean());
  if (req.query.mode !== "opportunities") return res.json(await Requirement.find({ customer: req.user._id }).sort({ createdAt: -1 }).lean());
  const c = await ownCreator(req.user);
  const rows = await Requirement.find({ status: { $in: published }, deadline: { $gte: new Date().toISOString().slice(0, 10) }, customer: { $ne: req.user._id } }).sort({ createdAt: -1 });
  res.json(rows.filter(r => eligible(c, r)).map(r => ({ ...view(r, req.user), matchingReason: "Your service, location and available hours match this approved requirement." })));
});
requirementRouter.get("/requirements/:id", async (req, res) => {
  const r = await access(req.user, req.params.id);
  const owner = isAdmin(req.user) || String(r.customer) === req.user.id;
  const c = owner ? null : await ownCreator(req.user);
  const proposals = await Proposal.find({ requirement: r._id, ...(!owner && { creator: c._id }) }).populate("creator", "businessName slug verified rating reviewCount profileImage").sort({ createdAt: -1 }).lean();
  res.json({ ...view(r, req.user), proposals: proposals.map(p => ({ ...p, message: moderate(p.message), terms: moderate(p.terms), inclusions: moderate(p.inclusions), history: undefined, answers: owner ? p.answers : undefined })) });
});
requirementRouter.put("/requirements/:id", validate(input), async (req, res) => {
  const r = await Requirement.findById(req.params.id); if (!r || (!isAdmin(req.user) && String(r.customer) !== req.user.id)) fail(404, "Requirement not found.");
  if (!["PENDING_ADMIN_REVIEW", "NEEDS_INFORMATION", "REJECTED"].includes(r.status)) fail(409, "Published requirements cannot be rewritten after proposals begin.");
  await checkAssets(req.body.attachments, req.user, "reference");
  Object.assign(r, req.body, { status: "PENDING_ADMIN_REVIEW" }); await r.save(); await audit(req.user, "REQUIREMENT_EDITED", "Requirement", r._id); res.json(r);
});
requirementRouter.patch("/requirements/:id/details", validate(z.object({ description: z.string().trim().min(20).max(10000), instructions: z.string().max(5000).optional(), services: z.array(z.string().max(200)).min(1).max(20).optional() })), async (req, res) => {
  const r = await Requirement.findById(req.params.id); if (!r || (!isAdmin(req.user) && String(r.customer) !== req.user.id)) fail(404, "Requirement not found.");
  if (!["PENDING_ADMIN_REVIEW", "NEEDS_INFORMATION", "REJECTED"].includes(r.status)) fail(409, "Published requirement details are locked.");
  if (req.body.services) { const services = await Service.distinct("title", { active: { $ne: false } }); if (req.body.services.some(s => !services.includes(s))) fail(400, "Choose active service categories."); }
  Object.assign(r, req.body); r.status = "PENDING_ADMIN_REVIEW"; r.history.push({ status: r.status, actor: req.user._id, at: new Date(), note: "Additional information supplied" }); await r.save(); await audit(req.user, "REQUIREMENT_DETAILS_UPDATED", "Requirement", r._id); res.json(r);
});
requirementRouter.post("/requirements/:id/review", adminOnly, validate(z.object({ action: z.enum(["approve", "reject", "information"]), reason: z.string().max(3000).default(""), publishingMode: z.enum(["PUBLIC_TO_MATCHING_CREATORS", "PRIVATE_INVITATION", "BOTH"]).default("PUBLIC_TO_MATCHING_CREATORS"), invited: z.array(id).max(100).default([]) })), async (req, res) => {
  const r = await Requirement.findById(req.params.id); if (!r) fail(404, "Requirement not found.");
  if (!["PENDING_ADMIN_REVIEW", "NEEDS_INFORMATION", "REJECTED"].includes(r.status)) fail(409, "This requirement has already been reviewed.");
  if (req.body.action !== "approve" && !req.body.reason.trim()) fail(400, "Give the customer a reason.");
  const previous = r.status;
  r.status = { approve: "PUBLISHED", reject: "REJECTED", information: "NEEDS_INFORMATION" }[req.body.action];
  r.reviewReason = req.body.reason; r.publishingMode = req.body.publishingMode; r.invited = req.body.invited;
  r.history.push({ status: r.status, actor: req.user._id, reason: r.reviewReason, at: new Date() }); await r.save();
  if (r.status === "PUBLISHED") { const creators = await Creator.find({ status: "Active", verified: true, applicationStatus: "APPROVED", user: { $exists: true } }); for (const c of creators.filter(c => eligible(c, r))) await notify(c.user, "New matching opportunity", `/creator/opportunities/${r._id}`); }
  await notify(r.customer, `Requirement: ${r.status}`, `/customer/requirements/${r._id}`); await audit(req.user, "REQUIREMENT_REVIEW", "Requirement", r._id, { status: previous }, { status: r.status, reason: r.reviewReason }); res.json(r);
});
const proposalInput = z.object({ services: z.array(z.string().max(200)).min(1).max(20), price: z.number().min(1).max(10000000), travelCharges: z.number().min(0).max(1000000).default(0), deliveryDays: z.number().int().min(0).max(730), message: z.string().trim().min(10).max(5000), inclusions: z.string().trim().min(5).max(5000), terms: z.string().max(5000).default(""), validUntil: futureDate, answers: z.record(z.string(), z.unknown()).default({}) });
requirementRouter.post("/requirements/:id/proposals", validate(proposalInput), async (req, res) => {
  const c = await ownCreator(req.user); const r = await access(req.user, req.params.id);
  if (String(r.customer) === req.user.id || !eligible(c, r)) fail(403, "You cannot propose for this requirement.");
  if (req.body.services.some(s => !r.services.includes(s) || (s !== c.category && !c.services.includes(s)))) fail(400, "Propose only for your relevant services.");
  if (await Proposal.exists({ requirement: r._id, creator: c._id })) fail(409, "You have already submitted a proposal. Revise the existing one.");
  const claim = await Requirement.findOneAndUpdate({ _id: r._id, status: "PUBLISHED", deadline: { $gte: new Date().toISOString().slice(0, 10) }, proposalCount: { $lt: r.proposalLimit } }, { $inc: { proposalCount: 1 } }, { new: true });
  if (!claim) fail(409, "This requirement is closed for new proposals.");
  let p;
  try { const answers = validateFields(await getFields("PROPOSAL_FORM", c.category), req.body.answers); p = await Proposal.create({ ...req.body, answers, requirement: r._id, creator: c._id, customer: r.customer, history: [{ status: "SUBMITTED", at: new Date(), actor: req.user._id, snapshot: req.body }] }); }
  catch (e) { await Requirement.updateOne({ _id: r._id }, { $inc: { proposalCount: -1 } }); throw e; }
  if (claim.proposalCount >= claim.proposalLimit) await Requirement.updateOne({ _id: r._id, status: "PUBLISHED" }, { $set: { status: "CLOSED_FOR_NEW_PROPOSALS" } });
  await notify(r.customer, "New proposal received", `/customer/requirements/${r._id}`); res.status(201).json(p);
});
requirementRouter.get("/proposals", async (req, res) => { const c = await Creator.findOne({ user: req.user._id }); const rows = await Proposal.find(isAdmin(req.user) ? {} : { $or: [{ customer: req.user._id }, ...(c ? [{ creator: c._id }] : [])] }).select("-history -answers").sort({ createdAt: -1 }).lean(); res.json(isAdmin(req.user) ? rows : rows.map(p => ({ ...p, message: moderate(p.message), terms: moderate(p.terms), inclusions: moderate(p.inclusions) }))); });
requirementRouter.put("/proposals/:id", validate(proposalInput), async (req, res) => {
  const c = await ownCreator(req.user); const p = await Proposal.findOne({ _id: req.params.id, creator: c._id }); if (!p) fail(404, "Proposal not found.");
  if (!["SUBMITTED", "REVISION_REQUESTED", "REVISED", "SHORTLISTED"].includes(p.status)) fail(409, "Proposal cannot be revised at this stage.");
  const r = await access(req.user, p.requirement); if (req.body.services.some(s => !r.services.includes(s) || (s !== c.category && !c.services.includes(s)))) fail(400, "Choose relevant services.");
  const snapshot = p.toObject(); delete snapshot.history;
  p.history.push({ status: p.status, at: new Date(), snapshot }); Object.assign(p, req.body, { status: "REVISED" }); await p.save(); res.json(p);
});
requirementRouter.post("/proposals/:id/actions", validate(z.object({ action: z.enum(["shortlist", "revision", "accept", "reject", "withdraw"]), reason: z.string().max(2000).default("") })), async (req, res) => {
  const p = await Proposal.findById(req.params.id); if (!p) fail(404, "Proposal not found."); const c = await Creator.findById(p.creator);
  const owner = String(p.customer) === req.user.id, author = c && String(c.user) === req.user.id;
  if ((!owner && !author) || (req.body.action === "withdraw" ? !author : !owner)) fail(403, "You cannot change this proposal.");
  if (["ACCEPTED", "REJECTED", "WITHDRAWN", "EXPIRED"].includes(p.status)) fail(409, "This proposal is already closed.");
  if (p.validUntil < new Date().toISOString().slice(0, 10)) fail(409, "This offer has expired.");
  const next = { shortlist: "SHORTLISTED", revision: "REVISION_REQUESTED", accept: "ACCEPTED", reject: "REJECTED", withdraw: "WITHDRAWN" }[req.body.action];
  let booking;
  if (next === "ACCEPTED") {
    const r = await Requirement.findById(p.requirement).select("+venue");
    if (!r || !published.includes(r.status)) fail(409, "Requirement is not open.");
    if (await Booking.exists({ requirement: r._id, service: { $in: p.services }, status: { $nin: ["CANCELLED", "ADMIN_REJECTED", "CREATOR_DECLINED", "REFUNDED"] } })) fail(409, "These services already have a booking.");
    const serviceClaim = await Requirement.findOneAndUpdate({ _id: r._id, acceptedServices: { $nin: p.services } }, { $addToSet: { acceptedServices: { $each: p.services } } });
    if (!serviceClaim) fail(409, "Another proposal has already been accepted for these services.");
    // Claim proposal before creating a booking; concurrent acceptance cannot create two bookings.
    const claimed = await Proposal.findOneAndUpdate({ _id: p._id, status: p.status, __v: p.__v }, { $set: { status: "ACCEPTING" }, $inc: { __v: 1 } }); if (!claimed) { await Requirement.updateOne({ _id: r._id }, { $pull: { acceptedServices: { $in: p.services } } }); fail(409, "Proposal changed. Refresh and retry."); }
    try { booking = await makeBooking({ title: r.title, event: r.event, date: r.date, startTime: r.startTime, endTime: r.endTime, city: r.city, venue: r.venue, guestCount: r.guestCount, instructions: r.description, service: p.services[0], packageName: p.inclusions }, req.user, c, p); }
    catch (e) { await Proposal.updateOne({ _id: p._id, status: "ACCEPTING" }, { $set: { status: p.status } }); await Requirement.updateOne({ _id: r._id }, { $pull: { acceptedServices: { $in: p.services } } }); throw e; }
    await Proposal.updateOne({ _id: p._id, status: "ACCEPTING" }, { $set: { status: next, booking: booking._id }, $push: { history: { status: next, at: new Date(), actor: req.user._id } } });
    const allocated = new Set([...(r.acceptedServices || []), ...p.services]);
    if (r.services.every(s => allocated.has(s))) await Requirement.updateOne({ _id: p.requirement }, { $set: { status: "BOOKED" } });
  } else { p.status = next; p.history.push({ status: next, at: new Date(), actor: req.user._id, reason: req.body.reason }); await p.save(); }
  await notify(owner ? c.user : p.customer, `Proposal: ${next}`, owner ? "/creator/proposals" : `/customer/requirements/${p.requirement}`);
  res.json({ ok: true, booking: booking?._id });
});
