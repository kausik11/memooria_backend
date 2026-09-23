import { Router } from "express";
import { z } from "zod";
import { EventType, DynamicForm, Setting, AuditLog } from "../models/marketplace.js";
import { Service } from "../models/index.js";
import { authenticate, adminOnly } from "../middleware/auth.js";
import { validate, imageUrl } from "../middleware/validate.js";
import { defaults, settings, audit, fail } from "../services/platform.js";
import { formSchema, getFields } from "../services/forms.js";
export const configurationRouter = Router();
configurationRouter.get("/events", async (req, res) => res.json(await EventType.find({ active: true }).sort({ sortOrder: 1 }).lean()));
configurationRouter.get("/forms", async (req, res) => res.json({ fields: await getFields(String(req.query.context || "REQUIREMENT_FORM"), String(req.query.category || "")) }));
configurationRouter.get("/platform", async (req, res) => { const s = await settings(); res.json({ defaultCurrency: s.defaultCurrency, demoMode: process.env.DEMO_MODE === "true", contactUnlockStage: s.contactUnlockStage }); });
configurationRouter.use("/admin/configuration", authenticate, adminOnly);
configurationRouter.get("/admin/configuration/:resource", async (req, res) => {
  const models = { events: EventType, forms: DynamicForm, categories: Service, audit: AuditLog };
  if (req.params.resource === "settings") return res.json(await settings());
  const Model = models[req.params.resource]; if (!Model) fail(404, "Resource not found.");
  res.json(await Model.find().sort({ createdAt: -1 }).limit(req.params.resource === "audit" ? 500 : 1000).lean());
});
const eventSchema = z.object({ title: z.string().trim().min(1).max(200), slug: z.string().regex(/^[a-z0-9-]+$/), description: z.string().max(2000).default(""), image: imageUrl.default(""), active: z.boolean().default(true), sortOrder: z.number().int().default(0), services: z.array(z.string().max(200)).max(100).default([]) });
const categorySchema = eventSchema.omit({ services: true }).extend({ kind: z.enum(["category", "service"]).default("category"), parentCategory: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional(), seoTitle: z.string().max(200).default(""), seoDescription: z.string().max(500).default(""), workflow: z.enum(["DIGITAL", "PHYSICAL", "RENTAL"]).default("DIGITAL") });
const settingSchema = z.object({ proposalLimit: z.number().int().min(1).max(100), contactUnlockStage: z.enum(["CONFIRMED", "IN_PROGRESS", "COMPLETED", "NEVER"]), defaultCurrency: z.literal("INR"), requireAdminBookingApproval: z.literal(true), requireAdminRequirementApproval: z.literal(true), commissionRate: z.number().min(0).max(100), allowedUploadSizes: z.number().min(1).max(100), creatorProfileMinimumCompletion: z.number().min(0).max(100), requireVerifiedCreatorsForMarketplace: z.boolean(), blockMessageUrls: z.boolean() });
configurationRouter.put("/admin/configuration/settings", validate(settingSchema), async (req, res) => { const before = await settings(); await Setting.findOneAndUpdate({ key: "platform" }, { value: req.body }, { upsert: true }); await audit(req.user, "SETTINGS_UPDATED", "Setting", "platform", before, req.body); res.json(req.body); });
for (const [resource, Model, schema] of [["events", EventType, eventSchema], ["forms", DynamicForm, formSchema], ["categories", Service, categorySchema]]) {
  configurationRouter.post(`/admin/configuration/${resource}`, validate(schema), async (req, res) => { const item = await Model.create(req.body); await audit(req.user, "CREATED", resource, item._id, null, req.body); res.status(201).json(item); });
  configurationRouter.put(`/admin/configuration/${resource}/:id`, validate(schema), async (req, res) => {
    const item = await Model.findById(req.params.id); if (!item) fail(404, "Record not found.");
    if (resource === "categories" && item.title !== req.body.title) fail(409, "Keep existing category names stable; create a new category and reassign creators instead.");
    if (resource === "categories" && req.body.parentCategory === String(item._id)) fail(400, "A category cannot be its own parent.");
    const before = item.toObject(); Object.assign(item, req.body); if (resource === "forms") item.version += 1; await item.save(); await audit(req.user, "UPDATED", resource, item._id, before, item.toObject()); res.json(item);
  });
  configurationRouter.delete(`/admin/configuration/${resource}/:id`, async (req, res) => { const item = await Model.findByIdAndUpdate(req.params.id, { active: false }, { new: true }); if (!item) fail(404, "Record not found."); await audit(req.user, "ARCHIVED", resource, item._id); res.json({ ok: true }); });
}
