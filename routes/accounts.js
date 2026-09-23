import { Router } from "express";
import { z } from "zod";
import { User, Creator } from "../models/index.js";
import { authenticate, adminOnly } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { fail, audit } from "../services/platform.js";
export const accountsRouter = Router();
accountsRouter.patch("/users/me", authenticate, validate(z.object({ name: z.string().trim().min(1).max(200), phone: z.string().trim().max(30) })), async (req, res) => { await User.updateOne({ _id: req.user._id }, { $set: req.body }); res.json({ ok: true }); });
accountsRouter.get("/admin/users", authenticate, adminOnly, async (req, res) => res.json(await User.find().select("name email role status createdAt onboarding demo").sort({ createdAt: -1 }).lean()));
accountsRouter.patch("/admin/users/:id", authenticate, adminOnly, validate(z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), role: z.enum(["user", "creator", "admin", "super_admin"]).optional() })), async (req, res) => {
  const u = await User.findById(req.params.id); if (!u) fail(404, "User not found.");
  if (String(u._id) === req.user.id) fail(409, "You cannot change your own access here.");
  if ((["admin", "super_admin"].includes(u.role) || req.body.role) && req.user.role !== "super_admin") fail(403, "Only a super administrator can manage roles or administrators.");
  const before = { status: u.status, role: u.role }; u.status = req.body.status; if (req.body.role) u.role = req.body.role; await u.save();
  if (u.status === "SUSPENDED") await Creator.updateOne({ user: u._id }, { $set: { status: "Inactive", applicationStatus: "SUSPENDED", verified: false } });
  await audit(req.user, "USER_ACCESS_UPDATED", "User", u._id, before, req.body); res.json({ ok: true });
});
