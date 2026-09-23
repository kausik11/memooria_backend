import { Setting, AuditLog, Notification } from "../models/marketplace.js";
export const defaults = { proposalLimit: 10, contactUnlockStage: "CONFIRMED", defaultCurrency: "INR", requireAdminBookingApproval: true, requireAdminRequirementApproval: true, commissionRate: 15, allowedUploadSizes: 100, creatorProfileMinimumCompletion: 80, requireVerifiedCreatorsForMarketplace: true, blockMessageUrls: true };
export const isAdmin = user => ["admin", "super_admin"].includes(user.role);
export const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
export async function settings() { const row = await Setting.findOne({ key: "platform" }).lean(); return { ...defaults, ...row?.value }; }
export async function audit(user, action, entityType, entityId, before, after) { await AuditLog.create({ actor: user._id, action, entityType, entityId: String(entityId), before, after }); }
export async function notify(user, title, link) { if (user) await Notification.create({ user, title, link }); }
export function moderate(text = "", blockUrls = true) {
  let result = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[Contact hidden]").replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "[Contact hidden]").replace(/(?:wa\.me|t\.me|whatsapp|telegram|instagram|facebook)\S*/gi, "[Contact hidden]").replace(/@[a-z0-9_.]+/gi, "[Contact hidden]");
  if (blockUrls) result = result.replace(/(?:https?:\/\/|www\.)\S+/gi, "[Link hidden]");
  return result;
}
export function publicCreator(c) {
  const out = { ...c };
  for (const key of ["email", "phone", "socialLinks", "application", "user", "verificationFiles", "reviewHistory", "reviewReason", "scheduleLock"]) delete out[key];
  for (const key of ["description", "businessName", "ownerName", "location"]) if (out[key]) out[key] = moderate(out[key]);
  for (const key of ["services", "serviceAreas", "languages", "eventTypes"]) if (out[key]) out[key] = out[key].map(value => moderate(value));
  out.packages = (out.packages || []).map(p => ({ ...p, description: moderate(p.description), name: moderate(p.name), includedItems: p.includedItems?.map(value => moderate(value)) }));
  return out;
}
