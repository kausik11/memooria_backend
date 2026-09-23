import mongoose from "mongoose";
const { Schema, model } = mongoose;
const ref = (name, required = false) => ({ type: Schema.Types.ObjectId, ref: name, required });
const make = (name, fields, indexes = []) => { const schema = new Schema(fields, { timestamps: true, optimisticConcurrency: true }); indexes.forEach(i => schema.index(...i)); return model(name, schema); };
export const EventType = make("EventType", { title: String, slug: { type: String, unique: true }, description: String, image: String, active: { type: Boolean, default: true }, sortOrder: { type: Number, default: 0 }, services: [String] });
export const DynamicForm = make("DynamicForm", { key: { type: String, unique: true }, name: String, context: String, category: { type: String, default: "" }, version: { type: Number, default: 1 }, active: { type: Boolean, default: true }, fields: [Schema.Types.Mixed] });
export const Setting = make("Setting", { key: { type: String, unique: true }, value: Schema.Types.Mixed });
export const AuditLog = make("AuditLog", { actor: ref("User"), action: String, entityType: String, entityId: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed });
export const Notification = make("Notification", { user: ref("User", true), title: String, link: String, read: { type: Boolean, default: false } });
export const Requirement = make("Requirement", {
  customer: ref("User", true), title: String, event: String, services: [String], date: String, startTime: String, endTime: String, city: String, venue: { type: String, select: false }, guestCount: Number, budgetMin: Number, budgetMax: Number, description: String, instructions: String, attachments: [ref("Asset")], answers: Schema.Types.Mixed,
  status: { type: String, default: "PENDING_ADMIN_REVIEW" }, reviewReason: String, deadline: String, publishingMode: { type: String, default: "PUBLIC_TO_MATCHING_CREATORS" }, invited: [ref("Creator")], acceptedServices: [String], proposalCount: { type: Number, default: 0 }, proposalLimit: Number, history: [Schema.Types.Mixed],
});
export const Proposal = make("Proposal", {
  requirement: ref("Requirement", true), creator: ref("Creator", true), customer: ref("User", true), services: [String], price: Number, travelCharges: Number, deliveryDays: Number, message: String, inclusions: String, terms: String, validUntil: String, answers: Schema.Types.Mixed, status: { type: String, default: "SUBMITTED" }, history: [Schema.Types.Mixed], booking: ref("Booking"),
}, [[{ requirement: 1, creator: 1 }, { unique: true }]]);
export const Booking = make("Booking", {
  services: [String],
  customer: ref("User", true), creator: ref("Creator", true), proposal: ref("Proposal"), requirement: ref("Requirement"), title: String, event: String, service: String, date: String, startTime: String, endTime: String, city: String, venue: { type: String, select: false }, guestCount: Number, instructions: String, packageName: String, amount: Number, currency: { type: String, default: "INR" }, commissionRate: Number, commissionAmount: Number, paymentStatus: { type: String, default: "PENDING" }, status: { type: String, default: "PENDING_ADMIN_REVIEW" }, creatorUser: ref("User", true), answers: Schema.Types.Mixed, attachments: [ref("Asset")], history: [Schema.Types.Mixed], workflow: { type: String, default: "DIGITAL" }, workflowStage: String, workflowNotes: String, clientConfirmed: { type: Boolean, default: false }, reviewReason: String,
}, [[{ proposal: 1 }, { unique: true, sparse: true }]]);
export const Reservation = make("Reservation", { creator: ref("Creator", true), date: String, minute: Number, booking: ref("Booking", true) }, [[{ creator: 1, date: 1, minute: 1 }, { unique: true }]]);
export const Project = make("Project", { booking: { ...ref("Booking", true), unique: true }, customer: ref("User"), creatorUser: ref("User"), title: String, notes: String });
export const Conversation = make("Conversation", { key: { type: String, unique: true }, context: String, entityId: String, participants: [ref("User")], title: String, readAt: { type: Map, of: Date } });
export const Message = make("Message", { conversation: ref("Conversation", true), sender: ref("User", true), original: { type: String, select: false }, text: String, moderated: Boolean, attachments: [ref("Asset")] });
export const Asset = make("Asset", { owner: ref("User", true), purpose: String, context: String, contextId: String, publicId: { type: String, select: false }, resourceType: String, deliveryType: String, format: String, originalFilename: String, mimeType: String, extension: String, size: Number, url: String, visibility: String, linkedPortfolioItem: String });
export const Delivery = make("Delivery", { booking: ref("Booking", true), creatorUser: ref("User", true), title: String, description: String, album: String, files: [ref("Asset")], version: Number, status: { type: String, default: "DELIVERED" }, revisions: [{ comment: String, timestamp: String, createdAt: Date, user: ref("User") }] });
export const Appeal = make("Appeal", { creator: ref("Creator", true), user: ref("User", true), reason: String, explanation: String, files: [ref("Asset")], status: { type: String, default: "SUBMITTED" }, decision: String, history: [Schema.Types.Mixed] });
export const Dispute = make("Dispute", { booking: ref("Booking", true), user: ref("User", true), reason: String, status: { type: String, default: "OPEN" }, resolution: String, files: [ref("Asset")] });
export const SavedCreator = make("SavedCreator", { user: ref("User", true), creator: ref("Creator", true) }, [[{ user: 1, creator: 1 }, { unique: true }]]);
export const Draft = make("Draft", { user: ref("User", true), key: String, kind: String, values: Schema.Types.Mixed, answers: Schema.Types.Mixed, attachments: [ref("Asset")], step: Number }, [[{ user: 1, key: 1 }, { unique: true }]]);
