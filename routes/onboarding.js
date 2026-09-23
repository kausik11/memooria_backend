import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { v2 as cloudinary } from "cloudinary";
import { authenticate, adminOnly } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Creator, Onboarding, Service, User } from "../models/index.js";
import { getFields, validateFields, validateFieldUploads } from "../services/forms.js";
const questions = (kind, category) => getFields(kind === "user" ? "CUSTOMER_REGISTRATION" : "CREATOR_ONBOARDING", category);

export const onboardingRouter = Router();
onboardingRouter.use("/admin/onboarding", authenticate, adminOnly, (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
onboardingRouter.get("/admin/onboarding", async (req, res) => {
  const [users, drafts, creators] = await Promise.all([
    User.find({ role: { $in: ["user", "creator"] } }).select("name email phone onboarding createdAt").sort({ createdAt: -1 }).lean(),
    Onboarding.find().select("user answers submitted updatedAt").lean(),
    Creator.find({ user: { $exists: true } }).select("user businessName status +application").lean(),
  ]);
  res.json(users.map(user => {
    const draft = drafts.find(d => String(d.user) === String(user._id));
    const creator = creators.find(c => String(c.user) === String(user._id));
    return { ...user, draft, creator };
  }));
});
onboardingRouter.patch("/admin/onboarding/users/:id", validate(z.object({
  name: z.string().trim().min(1).max(500), email: z.email().transform(v => v.toLowerCase()), phone: z.string().trim().max(30),
  city: z.string().trim().max(500), interests: z.array(z.string().max(500)).max(30), occasion: z.enum(["", "Wedding", "Family celebration", "Creative project", "Business event", "Just exploring"]),
})), async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: { $in: ["user", "creator"] } });
  if (!user) return res.status(404).json({ message: "User not found." });
  const { name, email, phone, city, interests, occasion } = req.body;
  const services = await Service.distinct("title");
  if (interests.some(v => !services.includes(v) && !user.onboarding?.interests?.includes(v))) return res.status(400).json({ message: "Choose valid service interests." });
  Object.assign(user, { name, email, phone, onboarding: { ...user.onboarding, city, interests, occasion } });
  await user.save();
  res.json({ ok: true });
});
onboardingRouter.patch("/admin/onboarding/creators/:id", validate(z.object({
  answers: z.record(z.string().max(100), z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.array(z.string().max(500)).max(30)])),
  status: z.enum(["Pending", "Active", "Inactive"]),
})), async (req, res) => {
  const creator = await Creator.findById(req.params.id).select("+application");
  if (!creator?.application) return res.status(404).json({ message: "Application not found." });
  const a = { ...creator.application };
  const definitions = await questions("creator", a.service);
  for (const [key, value] of Object.entries(req.body.answers)) {
    const q = definitions.find(q => q.id === key);
    if (!q || ["service", "image", "images", "checkbox", "file", "files", "video", "raw"].includes(q.type)) return res.status(400).json({ message: "This application field cannot be changed here." });
    a[key] = typeof value === "string" ? value.trim() : value;
  }
  const editable = definitions.filter(q => !["service", "image", "images", "checkbox", "file", "files", "video", "raw"].includes(q.type));
  Object.assign(a, validateFields(editable, a, await Service.distinct("title")));
  // Only changed answers update the public profile, preserving edits made in Creators.
  const mapping = { businessName: "businessName", phone: "phone", bio: "description", city: "city", state: "state" };
  for (const [key, field] of Object.entries(mapping)) if (key in req.body.answers) creator[field] = a[key];
  if ("city" in req.body.answers || "state" in req.body.answers) creator.location = `${creator.city}, ${creator.state}`;
  if ("perDayRate" in req.body.answers || "inclusions" in req.body.answers) {
    const rate = creator.packages.find(p => p.name === "Per day");
    if (rate) { rate.price = a.perDayRate; rate.description = a.inclusions; }
    else creator.packages.push({ name: "Per day", price: a.perDayRate, description: a.inclusions });
  }
  creator.application = a;
  creator.status = req.body.status;
  await creator.save();
  await Onboarding.updateOne({ user: creator.user }, { $set: { answers: a } });
  res.json({ ok: true });
});
const configure = () => cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
const answersSchema = z.object({ kind: z.enum(["user", "creator"]), answers: z.record(z.string().max(100), z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.array(z.string().max(500)).max(30)])) });
onboardingRouter.get("/onboarding/questions", async (req, res) => {
  const services = await Service.find().select("title").lean();
  res.json({ services: services.map(s => s.title), questions: await questions(req.query.kind === "user" ? "user" : "creator", String(req.query.service || "")) });
});
onboardingRouter.get("/onboarding", authenticate, async (req, res) => {
  const draft = await Onboarding.findOne({ user: req.user._id }).lean();
  const creator = await Creator.findOne({ user: req.user._id }).select("status").lean();
  res.json({ answers: draft?.answers || {}, submitted: !!creator, status: creator?.status, userCompleted: !!req.user.onboarding?.completed });
});
onboardingRouter.put("/onboarding", authenticate, validate(answersSchema), async (req, res) => {
  if (req.body.kind === "creator") await Onboarding.findOneAndUpdate({ user: req.user._id }, { $set: { answers: req.body.answers } }, { upsert: true });
  res.json({ ok: true });
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) });
onboardingRouter.post("/onboarding/upload/:purpose", authenticate, rateLimit({ windowMs: 3600000, limit: 30 }), async (req, res, next) => {
  if (!["profileImage", "workSamples", "idCard"].includes(req.params.purpose)) return res.status(400).json({ message: "Invalid upload purpose." });
  if (await Creator.exists({ user: req.user._id })) return res.status(409).json({ message: "Your application has already been submitted." });
  next();
}, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Choose a JPEG, PNG or WebP image under 5 MB." });
  if (!process.env.CLOUDINARY_API_SECRET) return res.status(503).json({ message: "Image uploads are not configured yet." });
  configure();
  const draft = await Onboarding.findOneAndUpdate({ user: req.user._id }, { $setOnInsert: { answers: {} } }, { upsert: true, new: true });
  const purpose = req.params.purpose;
  const result = await new Promise((resolve, reject) => cloudinary.uploader.upload_stream({ folder: `memooria/creators/${draft._id}/${purpose}`, resource_type: "image", type: purpose === "idCard" ? "authenticated" : "upload", allowed_formats: ["jpg", "png", "webp"], timeout: 60000 }, (error, result) => error ? reject(error) : resolve(result)).end(req.file.buffer));
  const asset = { purpose, publicId: result.public_id, format: result.format, url: purpose === "idCard" ? undefined : result.secure_url };
  await Onboarding.updateOne({ _id: draft._id }, { $push: { uploads: asset } });
  res.status(201).json({ value: asset.url || asset.publicId });
});
onboardingRouter.post("/onboarding/submit", authenticate, validate(answersSchema), async (req, res) => {
  const { kind, answers: input } = req.body;
  const services = await Service.distinct("title");
  const a = validateFields(await questions(kind, input.service), input, services);
  await validateFieldUploads(await questions(kind, input.service), a, req.user);
  if (kind === "user") {
    await User.updateOne({ _id: req.user._id }, { $set: { onboarding: { ...a, completed: true } } });
    return res.json({ ok: true });
  }
  const existing = await Creator.findOne({ user: req.user._id });
  if (existing) return res.json({ ok: true, status: existing.status });
  const draft = await Onboarding.findOne({ user: req.user._id });
  for (const purpose of ["profileImage", "workSamples", "idCard"]) {
    const values = Array.isArray(a[purpose]) ? a[purpose] : [a[purpose]];
    if (!draft || !values.every(value => draft.uploads.some(u => u.purpose === purpose && (purpose === "idCard" ? u.publicId : u.url) === value))) return res.status(400).json({ message: "Upload your own profile, work samples and ID before submitting." });
  }
  await Creator.create({ user: req.user._id, businessName: a.businessName, ownerName: req.user.name, slug: `creator-${draft._id}`, email: req.user.email, phone: a.phone, category: a.service, location: `${a.city}, ${a.state}`, city: a.city, state: a.state, description: a.bio, profileImage: a.profileImage, coverImage: a.workSamples[0], gallery: a.workSamples, services: [a.service], packages: [{ name: "Per day", price: a.perDayRate, description: a.inclusions }], application: { ...a, folder: `memooria/creators/${draft._id}` }, status: "Pending" });
  await User.updateOne({ _id: req.user._id, role: "user" }, { $set: { role: "creator" } });
  await Onboarding.updateOne({ _id: draft._id }, { $set: { answers: a, submitted: true } });
  res.status(201).json({ ok: true, status: "Pending" });
});
onboardingRouter.get("/admin/creator/:id/identity", authenticate, adminOnly, async (req, res) => {
  const creator = await Creator.findById(req.params.id).select("+application");
  if (!creator?.application?.idCard) return res.status(404).json({ message: "No identity document found." });
  const draft = await Onboarding.findOne({ user: creator.user });
  const asset = draft?.uploads.find(u => u.publicId === creator.application.idCard);
  if (!asset) return res.status(404).json({ message: "Document not found." });
  configure();
  res.set("Cache-Control", "no-store").json({ url: cloudinary.utils.private_download_url(asset.publicId, asset.format, { type: "authenticated", expires_at: Math.floor(Date.now() / 1000) + 300 }) });
});
