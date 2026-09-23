import { Router } from "express";
import { z } from "zod";
import { Draft } from "../models/marketplace.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { id } from "./bookings.js";
import { checkAssets } from "../services/marketplace.js";
export const draftsRouter = Router();
draftsRouter.use("/drafts", authenticate);
draftsRouter.get("/drafts", async (req, res) => res.json(await Draft.find({ user: req.user._id }).sort({ updatedAt: -1 }).lean()));
draftsRouter.get("/drafts/:key", async (req, res) => res.json(await Draft.findOne({ user: req.user._id, key: req.params.key }).lean()));
draftsRouter.put("/drafts/:key", validate(z.object({ kind: z.enum(["requirement", "booking", "proposal"]), values: z.record(z.string().max(100), z.unknown()), answers: z.record(z.string().max(100), z.unknown()).default({}), attachments: z.array(id).max(30).default([]), step: z.number().int().min(0).max(200).default(0) })), async (req, res) => {
  if (!/^[a-z0-9_-]{1,100}$/.test(req.params.key)) return res.status(400).json({ message: "Invalid draft key." });
  await checkAssets(req.body.attachments, req.user);
  res.json(await Draft.findOneAndUpdate({ user: req.user._id, key: req.params.key }, { $set: req.body }, { new: true, upsert: true }));
});
draftsRouter.delete("/drafts/:key", async (req, res) => { await Draft.deleteOne({ user: req.user._id, key: req.params.key }); res.json({ ok: true }); });
