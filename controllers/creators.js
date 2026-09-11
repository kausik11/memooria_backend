import { Creator, Review } from "../models/index.js";
import { z } from "zod";
import { date } from "../middleware/validate.js";
const querySchema = z.object({
  location: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  date: date.optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  featured: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(12),
  sort: z.enum(["recommended", "price", "rating"]).default("recommended"),
});
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export async function listCreators(req, res) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ message: "Invalid search filters." });
  const q = parsed.data,
    filter = { status: "Active" };
  if (q.location) filter.location = new RegExp(escape(q.location), "i");
  if (q.category) filter.category = q.category;
  if (q.date) filter.availability = q.date;
  if (q.rating) filter.rating = { $gte: q.rating };
  if (q.featured) filter.featured = q.featured === "true";
  if (q.minPrice !== undefined || q.maxPrice !== undefined)
    filter.packages = {
      $elemMatch: {
        price: {
          ...(q.minPrice !== undefined && { $gte: q.minPrice }),
          ...(q.maxPrice !== undefined && { $lte: q.maxPrice }),
        },
      },
    };
  const sort =
    q.sort === "price"
      ? { "packages.price": 1 }
      : q.sort === "rating"
        ? { rating: -1 }
        : { featured: -1, rating: -1, _id: 1 };
  const [items, total] = await Promise.all([
    Creator.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Creator.countDocuments(filter),
  ]);
  res.json({ items, total, page: q.page, pages: Math.ceil(total / q.limit) });
}
export async function getCreator(req, res) {
  const creator = await Creator.findOne({
    slug: req.params.slug,
    status: "Active",
  }).lean();
  if (!creator) return res.status(404).json({ message: "Creator not found." });
  const reviews = await Review.find({ creator: creator._id, approved: true })
    .select("customer rating comment createdAt")
    .sort({ createdAt: -1 })
    .lean();
  res.json({ ...creator, reviews });
}
export async function refreshRating(creator) {
  const reviews = await Review.find({ creator, approved: true });
  await Creator.findByIdAndUpdate(creator, {
    rating: reviews.length
      ? Math.round(
          (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10,
        ) / 10
      : 0,
    reviewCount: reviews.length,
  });
}
