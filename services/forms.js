import { z } from "zod";
import { DynamicForm, Asset } from "../models/marketplace.js";
import { questions } from "../config/questions.js";
import { fail } from "./platform.js";
export const fieldSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/), label: z.string().trim().min(1).max(500),
  type: z.enum(["text", "textarea", "number", "email", "tel", "url", "date", "time", "datetime-local", "select", "multiselect", "radio", "checkbox", "boolean", "image", "images", "file", "files", "video", "raw", "address", "location", "price", "currency", "section", "information", "service", "date_range", "time_range"]),
  optional: z.boolean().default(false), disabled: z.boolean().default(false), options: z.array(z.string().max(200)).max(100).optional(), help: z.string().max(1000).optional(), placeholder: z.string().max(500).optional(),
  minLength: z.number().int().min(0).max(10000).optional(), maxLength: z.number().int().min(1).max(10000).optional(), min: z.number().optional(), max: z.number().optional(), maxFiles: z.number().int().min(1).max(30).optional(), maxFileSize: z.number().min(1).max(100).optional(), allowedExtensions: z.array(z.string().max(10)).optional(),
  visibility: z.enum(["PUBLIC", "CUSTOMER", "CREATOR", "ADMIN", "ADMIN_AND_CREATOR", "BOOKED_PARTIES"]).default("ADMIN_AND_CREATOR"),
  when: z.object({ id: z.string().max(61), value: z.union([z.string(), z.boolean(), z.number()]), operator: z.enum(["equals", "notEquals", "contains", "in"]).default("equals") }).optional(),
});
export const formSchema = z.object({ key: z.string().regex(/^[a-z0-9_-]+$/).max(100), name: z.string().trim().min(1).max(200), context: z.enum(["CUSTOMER_REGISTRATION", "CREATOR_ONBOARDING", "REQUIREMENT_FORM", "DIRECT_BOOKING", "PROPOSAL_FORM", "SERVICE_COMPLETION"]), category: z.string().max(200).default(""), active: z.boolean().default(true), fields: z.array(fieldSchema).max(100) }).refine(v => new Set(v.fields.map(f => f.id)).size === v.fields.length, "Field keys must be unique").refine(v => v.context !== "CREATOR_ONBOARDING" || ["service", "businessName", "city", "state", "bio", "perDayRate", "inclusions", "profileImage", "workSamples", "idCard"].every(key => v.fields.some(f => f.id === key && !f.disabled && !f.optional)), "Creator onboarding must keep its required identity, profile, location, rate and portfolio fields. Other questions can be freely changed.");
export const shown = (q, answers) => {
  if (q.disabled) return false;
  if (!q.when) return true;
  const { id, value, operator = "equals" } = q.when;
  if (operator === "notEquals") return answers[id] !== value;
  if (operator === "contains") return Array.isArray(answers[id]) ? answers[id].includes(value) : String(answers[id] || "").includes(String(value));
  if (operator === "in") return String(value).split(",").includes(String(answers[id]));
  return answers[id] === value;
};
export async function getFields(context, category = "") {
  const form = await DynamicForm.findOne({ context, category, active: true }).sort({ updatedAt: -1 }).lean() || (category ? await DynamicForm.findOne({ context, category: "", active: true }).sort({ updatedAt: -1 }).lean() : null);
  if (form) return form.fields.filter(f => !f.disabled);
  if (["CUSTOMER_REGISTRATION", "CREATOR_ONBOARDING"].includes(context)) return questions(context === "CUSTOMER_REGISTRATION" ? "user" : "creator", category);
  return [];
}
export function validateFields(fields, answers = {}, services = []) {
  const clean = {};
  for (const q of fields) {
    if (!shown(q, answers) || ["section", "information"].includes(q.type)) continue;
    const v = typeof answers[q.id] === "string" ? answers[q.id].trim() : answers[q.id];
    if (q.optional && (v === undefined || v === "" || (Array.isArray(v) && !v.length))) continue;
    let valid = typeof v === "string" && v.length >= (q.minLength ?? 1) && v.length <= (q.maxLength || 5000);
    if (["number", "price"].includes(q.type)) valid = typeof v === "number" && Number.isFinite(v) && v >= (q.min ?? 0) && v <= (q.max ?? Number.MAX_SAFE_INTEGER);
    if (q.type === "checkbox") valid = v === true;
    if (q.type === "boolean") valid = typeof v === "boolean";
    if (q.type === "service") valid = services.includes(v);
    if (["select", "radio"].includes(q.type)) valid = q.options?.includes(v);
    if (["images", "files", "multiselect"].includes(q.type)) valid = Array.isArray(v) && v.length >= (q.min ?? 1) && v.length <= (q.maxFiles || 30) && v.every(x => typeof x === "string") && (q.type !== "multiselect" || v.every(x => (q.options || services).includes(x)));
    if (q.type === "url") valid = typeof v === "string" && URL.canParse(v) && new URL(v).protocol === "https:";
    if (q.type === "email") valid = z.email().safeParse(v).success;
    if (q.type === "tel") valid = typeof v === "string" && /^[+\d\s()-]{7,30}$/.test(v);
    if (q.type === "date") valid = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
    if (q.type === "time") valid = typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    if (q.type === "datetime-local") valid = typeof v === "string" && !isNaN(Date.parse(v));
    if (["date_range", "time_range"].includes(q.type)) valid = Array.isArray(v) && v.length === 2 && v.every(x => typeof x === "string" && (q.type === "time_range" ? /^([01]\d|2[0-3]):[0-5]\d$/.test(x) : /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x)))) && v[0] < v[1];
    if (!valid) fail(400, `Please check: ${q.label}`);
    clean[q.id] = v;
  }
  return clean;
}
export async function validateFieldUploads(fields, answers, user) {
  for (const q of fields.filter(f => ["image", "images", "file", "files", "video", "raw"].includes(f.type) && !["profileImage", "workSamples", "idCard"].includes(f.id) && shown(f, answers))) {
    const raw = answers[q.id]; if (!raw && q.optional) continue;
    const ids = Array.isArray(raw) ? raw : [raw];
    if (ids.some(id => typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id))) fail(400, `Upload files for: ${q.label}`);
    const assets = await Asset.find({ _id: { $in: ids }, owner: user._id });
    if (assets.length !== new Set(ids).size) fail(400, `Use your own uploaded files for: ${q.label}`);
    for (const asset of assets) {
      if (q.maxFileSize && asset.size > q.maxFileSize * 1024 * 1024) fail(400, `File too large for: ${q.label}`);
      if (q.allowedExtensions?.length && !q.allowedExtensions.map(x => x.replace(/^\./, "").toLowerCase()).includes(asset.extension)) fail(400, `Unsupported file format for: ${q.label}`);
      if (q.type === "raw" && !["cr2", "cr3", "nef", "arw", "raf", "orf", "rw2", "dng"].includes(asset.extension)) fail(400, `Upload original camera RAW files for: ${q.label}`);
      if (["image", "images"].includes(q.type) && asset.resourceType !== "image") fail(400, `Upload an image for: ${q.label}`);
      if (q.type === "video" && asset.resourceType !== "video") fail(400, `Upload a video for: ${q.label}`);
    }
  }
}
