import { Router } from "express";
import { z } from "zod";
import { Creator, User } from "../models/index.js";
import { Booking, Project, Reservation, Requirement } from "../models/marketplace.js";
import { authenticate, adminOnly } from "../middleware/auth.js";
import { validate, futureDate } from "../middleware/validate.js";
import { getFields, validateFields, validateFieldUploads } from "../services/forms.js";
import { bookingFor, bookingView, makeBooking, confirmBooking, contactUnlocked, privateBookingStatuses, checkAssets, ownCreator } from "../services/marketplace.js";
import { fail, isAdmin, audit, notify } from "../services/platform.js";
export const bookingRouter = Router();
export const id = z.string().regex(/^[a-f\d]{24}$/i);
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const eventInput = z.object({ title: z.string().trim().min(3).max(200), event: z.string().trim().min(1).max(200), date: futureDate, startTime: time, endTime: time, city: z.string().trim().min(1).max(200), venue: z.string().trim().max(1000).default(""), guestCount: z.number().int().min(1).max(100000).default(1), instructions: z.string().trim().max(5000).default(""), attachments: z.array(id).max(20).default([]), answers: z.record(z.string(), z.unknown()).default({}) });
bookingRouter.get("/availability/:id", async (req, res) => {
  const c = await Creator.findOne({ _id: req.params.id, status: "Active", verified: true }); if (!c) fail(404, "Creator not found.");
  const booked = await Booking.find({ creator: c._id, status: { $in: ["CONFIRMED", "IN_PROGRESS", "AWAITING_DELIVERY", "DELIVERED", "REVISION_REQUESTED"] } }).select("date startTime endTime -_id").lean();
  const recurring = Array.from({ length: 180 }, (_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10)).filter(d => (c.weeklyHours || []).some(s => s.weekday === new Date(d+"T12:00:00Z").getUTCDay()));
  res.json({ dates: [...new Set([...c.availability, ...c.timeSlots.filter(s => !s.blocked).map(s => s.date), ...recurring])].sort(), timeSlots: c.timeSlots, weeklyHours: c.weeklyHours, booked });
});
bookingRouter.use("/bookings", authenticate);
bookingRouter.get("/bookings", async (req, res) => {
  const filter = isAdmin(req.user) ? {} : { $or: [{ customer: req.user._id }, { creatorUser: req.user._id, status: { $nin: privateBookingStatuses } }] };
  const rows = await Booking.find(filter).sort({ createdAt: -1 });
  res.json(await Promise.all(rows.map(b => bookingView(b, req.user))));
});
bookingRouter.post("/bookings", validate(eventInput.extend({ creator: id, service: z.string().max(200), amount: z.number().min(1).max(10000000), packageName: z.string().max(200).default("") }).refine(v => v.startTime < v.endTime, "End time must follow start time")), async (req, res) => {
  const creator = await Creator.findById(req.body.creator); if (!creator) fail(404, "Creator not found.");
  if (req.body.service !== creator.category && !creator.services.includes(req.body.service)) fail(400, "Choose a service this creator offers.");
  await checkAssets(req.body.attachments, req.user, "reference");
  const answers = validateFields(await getFields("DIRECT_BOOKING", creator.category), req.body.answers);
  await validateFieldUploads(await getFields("DIRECT_BOOKING", creator.category), answers, req.user);
  const booking = await makeBooking({ ...req.body, answers }, req.user, creator);
  res.status(201).json(await bookingView(booking, req.user));
});
bookingRouter.get("/bookings/:id", async (req, res) => {
  const b = await bookingFor(req.user, req.params.id);
  const project = await Project.findOne({ booking: b._id });
  let contacts;
  if (isAdmin(req.user) || await contactUnlocked(b)) {
    const [customer, creator] = await Promise.all([User.findById(b.customer).select("name email phone"), Creator.findById(b.creator).select("businessName email phone")]); contacts = { customer, creator };
  }
  res.json({ ...await bookingView(b, req.user), project, contacts });
});
bookingRouter.patch("/bookings/:id/details", validate(z.object({ instructions: z.string().trim().min(10).max(5000), venue: z.string().max(1000).optional() })), async (req, res) => {
  const b = await bookingFor(req.user, req.params.id);
  if (String(b.customer) !== req.user.id && !isAdmin(req.user)) fail(403, "Only the customer or Memooria can update this request.");
  if (!["PENDING_ADMIN_REVIEW", "NEEDS_INFORMATION"].includes(b.status)) fail(409, "Request details are locked after approval.");
  Object.assign(b, req.body); b.status = "PENDING_ADMIN_REVIEW"; b.history.push({ status: b.status, actor: req.user._id, at: new Date(), note: "Updated request information" }); await b.save(); await audit(req.user, "BOOKING_DETAILS_UPDATED", "Booking", b._id); res.json(await bookingView(b, req.user));
});
const actionInput = z.object({ action: z.enum(["approve", "reject", "information", "accept", "decline", "confirm", "paid", "start", "complete-service", "complete", "cancel", "refund"]), reason: z.string().trim().max(3000).default(""), answers: z.record(z.string(), z.unknown()).default({}) });
bookingRouter.post("/bookings/:id/actions", validate(actionInput), async (req, res) => {
  const b = await bookingFor(req.user, req.params.id); const { action, reason } = req.body;
  const admin = isAdmin(req.user), customer = String(b.customer) === req.user.id, creator = String(b.creatorUser) === req.user.id;
  if (creator && !admin) await ownCreator(req.user);
  const previous = b.status; let next;
  if (["approve", "reject", "information", "paid", "refund"].includes(action) && !admin) fail(403, "Administrator access required.");
  if (action === "approve" && ["PENDING_ADMIN_REVIEW", "NEEDS_INFORMATION"].includes(previous)) next = "SENT_TO_CREATOR";
  if (action === "reject" && ["PENDING_ADMIN_REVIEW", "NEEDS_INFORMATION"].includes(previous) && reason) next = "ADMIN_REJECTED";
  if (action === "information" && ["PENDING_ADMIN_REVIEW", "SENT_TO_CREATOR"].includes(previous) && reason) next = "NEEDS_INFORMATION";
  if (["accept", "decline"].includes(action) && creator && ["SENT_TO_CREATOR", "CREATOR_REVIEWING"].includes(previous)) next = action === "accept" ? "AWAITING_CLIENT_CONFIRMATION" : "CREATOR_DECLINED";
  if (action === "confirm" && customer && ["AWAITING_CLIENT_CONFIRMATION", "AWAITING_PAYMENT"].includes(previous)) { b.clientConfirmed = true; next = "AWAITING_PAYMENT"; }
  if (action === "paid" && ["AWAITING_CLIENT_CONFIRMATION", "AWAITING_PAYMENT"].includes(previous)) { b.paymentStatus = "PAID"; next = b.clientConfirmed ? "AWAITING_PAYMENT" : "AWAITING_CLIENT_CONFIRMATION"; }
  if (action === "start" && creator && previous === "CONFIRMED") next = "IN_PROGRESS";
  if (action === "complete-service" && creator && ["CONFIRMED", "IN_PROGRESS", "REVISION_REQUESTED"].includes(previous) && b.workflow !== "DIGITAL") next = "DELIVERED";
  if (action === "complete-service" && next) {
    if (b.workflow === "RENTAL" && b.workflowStage !== "INSPECTION") fail(409, "Complete return and inspection before marking this rental delivered.");
    const fields = await getFields("SERVICE_COMPLETION", b.service);
    const answers = validateFields(fields, req.body.answers); await validateFieldUploads(fields, answers, req.user);
    b.answers = { ...b.answers, completion: answers };
  }
  if (action === "complete" && customer && previous === "DELIVERED") next = "COMPLETED";
  if (action === "cancel" && (customer || creator || admin) && !["COMPLETED", "CANCELLED", "REFUNDED", "REFUND_PENDING"].includes(previous)) next = b.paymentStatus === "PAID" ? "REFUND_PENDING" : "CANCELLED";
  if (action === "refund" && previous === "REFUND_PENDING") { next = "REFUNDED"; b.paymentStatus = "REFUNDED"; }
  if (!next) fail(409, "This action is not allowed at the current booking stage. Rejections and information requests need a reason.");
  b.status = next; b.reviewReason = reason; b.history.push({ status: next, actor: req.user._id, at: new Date(), reason });
  await b.save();
  if (b.clientConfirmed && b.paymentStatus === "PAID" && ["AWAITING_PAYMENT", "AWAITING_CLIENT_CONFIRMATION"].includes(b.status)) await confirmBooking(b);
  if (["CANCELLED", "REFUND_PENDING", "REFUNDED"].includes(b.status)) await Reservation.deleteMany({ booking: b._id });
  if (b.requirement && ["CANCELLED", "REFUND_PENDING", "ADMIN_REJECTED", "CREATOR_DECLINED"].includes(b.status)) await Requirement.updateOne({ _id: b.requirement }, { $pull: { acceptedServices: { $in: b.services?.length ? b.services : [b.service] } }, $set: { status: "CLOSED_FOR_NEW_PROPOSALS" } });
  if (action === "approve") await notify(b.creatorUser, "New approved booking request", `/creator/bookings/${b._id}`);
  if (action !== "approve") { await notify(b.customer, `Booking: ${b.status}`, `/customer/bookings/${b._id}`); if (!privateBookingStatuses.includes(previous)) await notify(b.creatorUser, `Booking: ${b.status}`, `/creator/bookings/${b._id}`); }
  await audit(req.user, `BOOKING_${action.toUpperCase()}`, "Booking", b._id, { status: previous }, { status: b.status, reason });
  res.json(await bookingView(b, req.user));
});
bookingRouter.patch("/bookings/:id/workflow", validate(z.object({ stage: z.enum(["PICKUP_PENDING", "PICKED_UP", "IN_RENTAL", "RETURN_PENDING", "RETURNED", "INSPECTION"]), notes: z.string().max(3000) })), async (req, res) => {
  const b = await bookingFor(req.user, req.params.id);
  if (String(b.creatorUser) !== req.user.id || b.workflow !== "RENTAL" || !["CONFIRMED", "IN_PROGRESS"].includes(b.status)) fail(403, "Rental creator access required.");
  const stages = ["", "PICKUP_PENDING", "PICKED_UP", "IN_RENTAL", "RETURN_PENDING", "RETURNED", "INSPECTION"];
  if (stages.indexOf(req.body.stage) !== stages.indexOf(b.workflowStage || "") + 1) fail(409, "Follow the rental stages in order.");
  b.workflowStage = req.body.stage; b.workflowNotes = req.body.notes; b.history.push({ stage: b.workflowStage, notes: b.workflowNotes, actor: req.user._id, at: new Date() }); await b.save(); res.json(await bookingView(b, req.user));
});
