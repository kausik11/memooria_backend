import { z } from "zod";
export const text = z.string().trim().min(1).max(500);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
export const futureDate = date.refine(
  (v) => v >= new Date().toISOString().slice(0, 10),
  "Choose today or a future date",
);
export const imageUrl = z
  .string()
  .url()
  .refine((v) => {
    if (!URL.canParse(v)) return false;
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      ["images.unsplash.com", "res.cloudinary.com"].includes(u.hostname)
    );
  }, "Use an Unsplash or Cloudinary HTTPS image URL")
  .or(z.literal(""));
export const requiredImageUrl = imageUrl.refine(
  (value) => value.trim().length > 0,
  "An image URL is required",
);
const link = z
  .string()
  .url()
  .refine(
    (v) => URL.canParse(v) && new URL(v).protocol === "https:",
    "Use an HTTPS URL",
  )
  .or(z.literal(""));
export const creatorInput = z.object({
  businessName: text,
  ownerName: text,
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120),
  profileImage: imageUrl,
  coverImage: imageUrl,
  email: z.email(),
  phone: text,
  category: text,
  location: text,
  city: z.string().max(100),
  state: z.string().max(100),
  description: z.string().trim().min(20).max(10000),
  services: z.array(text).max(40),
  gallery: z.array(requiredImageUrl).max(40),
  packages: z
    .array(
      z.object({
        name: text,
        price: z.number().min(0).max(10000000),
        description: z.string().max(1000),
      }),
    )
    .max(10),
  availability: z.array(date).max(1000),
  socialLinks: z.object({ instagram: link, facebook: link, website: link }),
  featured: z.boolean(),
  status: z.enum(["Active", "Inactive", "Pending"]),
});
export const serviceInput = z.object({
  title: text,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: text,
  image: imageUrl,
  kind: z.enum(["category", "service"]).default("category"),
});
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success)
      return res.status(400).json({
        message: result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    req.body = result.data;
    next();
  };
}
