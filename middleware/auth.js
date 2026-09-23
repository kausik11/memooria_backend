import jwt from "jsonwebtoken";
import { User } from "../models/index.js";
export async function authenticate(req, res, next) {
  try {
    const token = req.cookies.memooria_session;
    if (!token)
      return res.status(401).json({ message: "Please sign in to continue." });
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    req.user = await User.findById(decoded.sub);
    if (!req.user)
      return res.status(401).json({ message: "Your session has expired." });
    if (req.user.status !== "ACTIVE" || (req.user.demo && process.env.DEMO_MODE !== "true")) return res.status(403).json({ message: "This account is not available." });
    next();
  } catch {
    res
      .status(401)
      .json({ message: "Your session has expired. Please sign in again." });
  }
}
export function adminOnly(req, res, next) {
  if (!["admin", "super_admin"].includes(req.user.role))
    return res.status(403).json({ message: "Administrator access required." });
  next();
}
