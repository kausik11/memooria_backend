import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/index.js";
export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 1000 * 60 * 60 * 8,
});
function session(res, user) {
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "8h",
  });
  res.cookie("memooria_session", token, cookieOptions());
  return { _id: user.id, name: user.name, email: user.email, role: user.role };
}
export async function register(req, res) {
  const user = await User.create({
    ...req.body,
    password: await bcrypt.hash(req.body.password, 12),
    role: "user",
  });
  res.status(201).json(session(res, user));
}
export async function login(req, res) {
  const user = await User.findOne({ email: req.body.email }).select(
    "+password",
  );
  if (!user || !(await bcrypt.compare(req.body.password, user.password)))
    return res.status(401).json({ message: "Email or password is incorrect." });
  res.json(session(res, user));
}
