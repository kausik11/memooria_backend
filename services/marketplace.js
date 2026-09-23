import { randomUUID } from "node:crypto";
import { Creator, Service } from "../models/index.js";
import { Booking, Reservation, Project, Conversation, Asset } from "../models/marketplace.js";
import { fail, settings, notify, isAdmin, moderate } from "./platform.js";
export const privateBookingStatuses = ["PENDING_ADMIN_REVIEW", "ADMIN_REJECTED", "NEEDS_INFORMATION"];
export const confirmedStatuses = ["CONFIRMED", "IN_PROGRESS", "AWAITING_DELIVERY", "DELIVERED", "REVISION_REQUESTED", "COMPLETED", "DISPUTED"];
export const minute = value => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
export async function ownCreator(user, approved = true) {
  const c = await Creator.findOne({ user: user._id });
  if (!c) fail(403, "Create a creator application first.");
  if (approved && (c.status !== "Active" || !c.verified || c.applicationStatus !== "APPROVED")) fail(403, "An approved, active creator account is required.");
  return c;
}
export function available(c, date, startTime, endTime) {
  const slots = (c.timeSlots || []).filter(s => s.date === date);
  if (slots.some(s => s.blocked && s.startTime < endTime && s.endTime > startTime)) return false;
  if (slots.some(s => !s.blocked)) return slots.some(s => !s.blocked && s.startTime <= startTime && s.endTime >= endTime);
  return c.availability.includes(date) || (c.weeklyHours || []).some(s => s.weekday === new Date(`${date}T12:00:00Z`).getUTCDay() && s.startTime <= startTime && s.endTime >= endTime);
}
export function matches(c, r) {
  if (c.status !== "Active" || !c.verified || c.applicationStatus !== "APPROVED") return false;
  if (!r.services.some(s => c.category === s || c.services.includes(s))) return false;
  const places = [c.city, ...(c.serviceAreas || []), ...(c.temporaryLocations || []).filter(l => l.from <= r.date && l.until >= r.date).map(l => l.city)].filter(Boolean).map(s => s.toLowerCase());
  if (!c.travelAvailable && !places.includes(r.city.toLowerCase())) return false;
  return available(c, r.date, r.startTime, r.endTime);
}
export const eligible = (c, r) => r.invited.some(id => String(id) === String(c._id)) ? c.status === "Active" && c.verified && c.applicationStatus === "APPROVED" && r.services.some(s => c.category === s || c.services.includes(s)) && available(c, r.date, r.startTime, r.endTime) : r.publishingMode !== "PRIVATE_INVITATION" && matches(c, r);
export async function bookingFor(user, id) {
  const b = await Booking.findById(id).select("+venue"); if (!b) fail(404, "Booking not found.");
  if (!isAdmin(user) && String(b.customer) !== user.id && (String(b.creatorUser) !== user.id || privateBookingStatuses.includes(b.status))) fail(404, "Booking not found.");
  return b;
}
export async function contactUnlocked(b) {
  const s = await settings();
  if (s.contactUnlockStage === "NEVER") return false;
  if (s.contactUnlockStage === "COMPLETED") return b.status === "COMPLETED";
  if (s.contactUnlockStage === "IN_PROGRESS") return confirmedStatuses.filter(x => x !== "CONFIRMED").includes(b.status);
  return confirmedStatuses.includes(b.status);
}
export async function bookingView(b, user) {
  const obj = b.toObject ? b.toObject() : { ...b };
  const unlocked = isAdmin(user) || await contactUnlocked(b);
  if (!unlocked) { delete obj.venue; obj.instructions = moderate(obj.instructions); obj.title = moderate(obj.title); obj.city = moderate(obj.city); obj.packageName = moderate(obj.packageName); obj.reviewReason = moderate(obj.reviewReason); obj.answers = {}; obj.history = (obj.history || []).map(h => ({ status: h.status, stage: h.stage, at: h.at, reason: moderate(h.reason), note: moderate(h.note) })); }
  return { ...obj, contactUnlocked: unlocked };
}
export async function checkAssets(ids, user, purpose) {
  if (!ids?.length) return;
  const unique = [...new Set(ids.map(String))];
  if (await Asset.countDocuments({ _id: { $in: unique }, owner: user._id, ...(purpose && { purpose }) }) !== unique.length) fail(400, "Attach only your own uploaded files of the correct type.");
}
export async function makeBooking(data, customer, creator, proposal) {
  if (data.date < new Date().toISOString().slice(0, 10)) fail(409, "This event date has passed. Create a new request.");
  if (!creator.user || !creator.verified || creator.status !== "Active" || creator.applicationStatus !== "APPROVED") fail(400, "This creator cannot receive bookings yet.");
  if (String(customer._id) === String(creator.user)) fail(400, "You cannot book yourself.");
  if (!available(creator, data.date, data.startTime, data.endTime)) fail(409, "Creator is unavailable for these hours.");
  const s = await settings();
  const category = await Service.findOne({ title: creator.category });
  const amount = proposal ? proposal.price + (proposal.travelCharges || 0) : data.amount;
  return Booking.create({ ...data, services: proposal ? proposal.services : [data.service], customer: customer._id, creator: creator._id, creatorUser: creator.user, amount, currency: s.defaultCurrency, commissionRate: s.commissionRate, commissionAmount: Math.round(amount * s.commissionRate) / 100, workflow: category?.workflow || "DIGITAL", ...(proposal && { proposal: proposal._id, requirement: proposal.requirement }), history: [{ status: "PENDING_ADMIN_REVIEW", actor: customer._id, at: new Date() }] });
}
export async function confirmBooking(b) {
  const token = randomUUID();
  const lock = await Creator.findOneAndUpdate({ _id: b.creator, $or: [{ "scheduleLock.until": { $lt: new Date() } }, { "scheduleLock.until": { $exists: false } }] }, { $set: { scheduleLock: { token, until: new Date(Date.now() + 60000) } } });
  if (!lock) fail(409, "This calendar is being updated. Please retry.");
  let committed = false;
  try {
    if (!available(lock, b.date, b.startTime, b.endTime)) fail(409, "Creator availability changed. Contact support.");
    const start = minute(b.startTime), end = minute(b.endTime);
    if (await Reservation.exists({ creator: b.creator, date: b.date, minute: { $gte: start, $lt: end }, booking: { $ne: b._id } })) fail(409, "These hours are already booked.");
    await Reservation.deleteMany({ booking: b._id });
    await Reservation.insertMany(Array.from({ length: end - start }, (_, i) => ({ creator: b.creator, date: b.date, minute: start + i, booking: b._id })));
    b.status = "CONFIRMED";
    b.history.push({ status: b.status, at: new Date(), note: "Client confirmation and admin-recorded payment received" });
    await b.save();
    committed = true;
    await Project.findOneAndUpdate({ booking: b._id }, { $setOnInsert: { customer: b.customer, creatorUser: b.creatorUser, title: b.title } }, { upsert: true });
    await Conversation.findOneAndUpdate({ key: `booking:${b._id}` }, { $setOnInsert: { context: "BOOKING", entityId: String(b._id), participants: [b.customer, b.creatorUser], title: b.title } }, { upsert: true });
    await notify(b.customer, "Booking confirmed", `/customer/bookings/${b._id}`);
    await notify(b.creatorUser, "Booking confirmed", `/creator/bookings/${b._id}`);
  } catch (e) { if (!committed) await Reservation.deleteMany({ booking: b._id }); throw e; }
  finally { await Creator.updateOne({ _id: b.creator, "scheduleLock.token": token }, { $unset: { scheduleLock: 1 } }); }
}
