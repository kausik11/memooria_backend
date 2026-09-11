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
    next();
  } catch {
    res
      .status(401)
      .json({ message: "Your session has expired. Please sign in again." });
  }
}
export function adminOnly(req, res, next) {
  if (req.user.role !== "admin")
    return res.status(403).json({ message: "Administrator access required." });
  next();
}
