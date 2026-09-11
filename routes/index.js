import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { rateLimit } from "express-rate-limit";
import {
  User,
  Creator,
  Service,
  Inquiry,
  Review,
  SiteContent,
} from "../models/index.js";
import { authenticate, adminOnly } from "../middleware/auth.js";
import {
  validate,
  text,
  futureDate,
  creatorInput,
  serviceInput,
  requiredImageUrl,
} from "../middleware/validate.js";
import { register, login, cookieOptions } from "../controllers/auth.js";
import {
  listCreators,
  getCreator,
  refreshRating,
} from "../controllers/creators.js";
export const router = Router();
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const postLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const credentials = z.object({
  email: z.email().transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(72),
});
router.post(
  "/auth/register",
  authLimit,
  validate(
    credentials.extend({ name: text, phone: z.string().max(30).optional() }),
  ),
  register,
);
router.post("/auth/login", authLimit, validate(credentials), login);
router.post("/auth/logout", (req, res) => {
  res.clearCookie("memooria_session", {
    ...cookieOptions(),
    maxAge: undefined,
  });
  res.json({ ok: true });
});
router.get("/auth/me", authenticate, (req, res) => res.json(req.user));
router.get("/creators", listCreators);
router.get("/search", listCreators);
router.get("/creators/:slug", getCreator);
router.get("/services", async (req, res) =>
  res.json(await Service.find().sort({ createdAt: 1 }).lean()),
);
router.get("/content", async (req, res) => {
  const [content, creators, users, events, cities, reviews] = await Promise.all(
    [
      SiteContent.findOne({ key: "homepage" }).lean(),
      Creator.countDocuments({ status: "Active" }),
      User.countDocuments({ role: "user" }),
      Inquiry.countDocuments({ status: "Completed" }),
      Creator.distinct("city", { status: "Active" }),
      Review.find({ approved: true })
        .select("customer rating comment")
        .limit(3)
        .lean(),
    ],
  );
  res.json({
    ...(content?.value || { slides: [], gallery: [] }),
    stats: { creators, users, events, cities: cities.filter(Boolean).length },
    reviews,
  });
});
router.post(
  "/inquiry",
  postLimit,
  validate(
    z.object({
      name: text,
      email: z.email(),
      phone: z.string().trim().min(7).max(30),
      creator: z.string().refine(mongoose.isValidObjectId).optional(),
      service: z.string().max(200).optional(),
      date: futureDate.optional(),
      message: z.string().trim().min(10).max(5000),
    }),
  ),
  async (req, res) => {
    if (req.body.creator) {
      const creator = await Creator.findOne({
        _id: req.body.creator,
        status: "Active",
      });
      if (!creator)
        return res.status(404).json({ message: "Creator not found." });
      if (!req.body.date || !creator.availability.includes(req.body.date))
        return res.status(409).json({
          message: "Choose an available date from the creator calendar.",
        });
    }
    res.status(201).json(await Inquiry.create(req.body));
  },
);
router.post(
  "/reviews",
  authenticate,
  postLimit,
  validate(
    z.object({
      creator: z.string().refine(mongoose.isValidObjectId),
      rating: z.number().int().min(1).max(5),
      comment: z.string().trim().min(10).max(2000),
    }),
  ),
  async (req, res) => {
    if (!(await Creator.exists({ _id: req.body.creator, status: "Active" })))
      return res.status(404).json({ message: "Creator not found." });
    res.status(201).json(
      await Review.create({
        ...req.body,
        user: req.user._id,
        customer: req.user.name,
      }),
    );
  },
);
router.use("/admin", authenticate, adminOnly);
router.get("/admin/dashboard", async (req, res) => {
  const [creators, users, inquiries, completed, recent] = await Promise.all([
    Creator.countDocuments(),
    User.countDocuments({ role: "user" }),
    Inquiry.countDocuments(),
    Inquiry.countDocuments({ status: "Completed" }),
    Inquiry.find()
      .populate("creator", "businessName")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);
  res.json({ creators, users, inquiries, completed, bookings: 0, recent });
});
router.get("/admin/creators", async (req, res) =>
  res.json(await Creator.find().sort({ createdAt: -1 }).lean()),
);
router.post("/admin/creator", validate(creatorInput), async (req, res) =>
  res.status(201).json(await Creator.create(req.body)),
);
router.put("/admin/creator/:id", validate(creatorInput), async (req, res) => {
  const item = await Creator.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!item) return res.status(404).json({ message: "Creator not found." });
  res.json(item);
});
router.delete("/admin/creator/:id", async (req, res) => {
  const item = await Creator.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ message: "Creator not found." });
  await Review.deleteMany({ creator: item._id });
  res.json({ ok: true });
});
router.post("/admin/services", validate(serviceInput), async (req, res) =>
  res.status(201).json(await Service.create(req.body)),
);
router.put("/admin/services/:id", validate(serviceInput), async (req, res) => {
  const previous = await Service.findById(req.params.id);
  if (!previous) return res.status(404).json({ message: "Service not found." });
  if (
    previous.title !== req.body.title &&
    (await Creator.exists({ category: previous.title }))
  ) {
    return res.status(409).json({
      message:
        "This category has creators. Create the new category and reassign those creators before renaming it.",
    });
  }
  const item = await Service.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!item) return res.status(404).json({ message: "Service not found." });
  res.json(item);
});
router.delete("/admin/services/:id", async (req, res) => {
  const item = await Service.findById(req.params.id);
  if (!item) return res.status(404).json({ message: "Service not found." });
  if (await Creator.exists({ category: item.title }))
    return res.status(409).json({
      message: "Reassign creators in this category before deleting it.",
    });
  await item.deleteOne();
  res.json({ ok: true });
});
router.get("/admin/inquiries", async (req, res) =>
  res.json(
    await Inquiry.find()
      .populate("creator", "businessName")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean(),
  ),
);
router.patch(
  "/admin/inquiries/:id",
  validate(z.object({ status: z.enum(["New", "Contacted", "Completed"]) })),
  async (req, res) => {
    const item = await Inquiry.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!item) return res.status(404).json({ message: "Inquiry not found." });
    res.json(item);
  },
);
router.get("/admin/reviews", async (req, res) =>
  res.json(
    await Review.find()
      .populate("creator", "businessName")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean(),
  ),
);
router.patch(
  "/admin/reviews/:id",
  validate(z.object({ approved: z.boolean() })),
  async (req, res) => {
    const item = await Review.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!item) return res.status(404).json({ message: "Review not found." });
    await refreshRating(item.creator);
    res.json(item);
  },
);
router.put(
  "/admin/content",
  validate(
    z.object({
      slides: z
        .array(z.object({ image: requiredImageUrl, label: text }))
        .min(1)
        .max(8),
      gallery: z.array(requiredImageUrl).max(20),
    }),
  ),
  async (req, res) =>
    res.json(
      await SiteContent.findOneAndUpdate(
        { key: "homepage" },
        { value: req.body },
        { upsert: true, new: true },
      ),
    ),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
router.post("/admin/upload", upload.single("image"), async (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ message: "Upload a JPEG, PNG, or WebP image under 5 MB." });
  if (!process.env.CLOUDINARY_API_SECRET)
    return res.status(503).json({
      message:
        "Configure Cloudinary credentials on the backend to enable uploads.",
    });
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  const result = await new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { folder: "memooria", resource_type: "image" },
        (err, result) => (err ? reject(err) : resolve(result)),
      )
      .end(req.file.buffer);
  });
  res.status(201).json({ url: result.secure_url });
});
