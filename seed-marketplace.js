import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDatabase } from "./config/database.js";
import { seed } from "./seed.js";
import { User, Creator, Service } from "./models/index.js";
import { EventType, DynamicForm, Setting, Requirement, Proposal, Booking, Notification } from "./models/marketplace.js";
import { questions } from "./config/questions.js";
import { defaults } from "./services/platform.js";
export async function seedMarketplace() {
  await seed();
  await Setting.updateOne({ key: "platform" }, { $setOnInsert: { value: defaults } }, { upsert: true });
  const categories = await Service.find();
  for (const c of categories) {
    if (["Camera Rental", "Studio Rental"].includes(c.title)) c.workflow = "RENTAL";
    else if (!["Photography", "Videography"].includes(c.title)) c.workflow = "PHYSICAL";
    await c.save();
    const key = `onboarding-${c.slug}`;
    await DynamicForm.updateOne({ key }, { $setOnInsert: { key, name: `${c.title} onboarding`, context: "CREATOR_ONBOARDING", category: c.title, fields: questions("creator", c.title).map(f => ({ ...f, visibility: f.id === "idCard" || f.id === "address" ? "ADMIN" : "ADMIN_AND_CREATOR" })) } }, { upsert: true });
  }
  await DynamicForm.updateOne({ key: "customer-registration" }, { $setOnInsert: { key: "customer-registration", name: "Customer registration", context: "CUSTOMER_REGISTRATION", category: "", fields: questions("user") } }, { upsert: true });
  for (const [key, name, context] of [["requirement", "Requirement details", "REQUIREMENT_FORM"], ["booking", "Direct booking details", "DIRECT_BOOKING"], ["proposal", "Proposal details", "PROPOSAL_FORM"], ["completion", "Service completion", "SERVICE_COMPLETION"]]) await DynamicForm.updateOne({ key }, { $setOnInsert: { key, name, context, category: "", fields: [{ id: "additionalNotes", label: "Additional preferences or notes", type: "textarea", optional: true }] } }, { upsert: true });
  for (const [sortOrder, title] of ["Wedding", "Birthday", "Engagement", "Anniversary", "Pre-Wedding", "Baby Shower", "Corporate Event", "Product Shoot", "Festival", "Reception", "Maternity", "Other"].entries()) {
    const slug = title.toLowerCase().replaceAll(" ", "-"); await EventType.updateOne({ slug }, { $setOnInsert: { title, slug, sortOrder, services: title === "Wedding" ? ["Photography", "Videography", "Makeup Artist", "Mehendi Artist", "Event Decoration", "Wedding Planner"] : ["Photography", "Videography", "Event Decoration"] } }, { upsert: true });
  }
  const accounts = [["Customer Demo", "customer", "user", "Demo@123"], ["Photographer Demo", "photographer", "creator", "Demo@123"], ["Makeup Demo", "makeup", "creator", "Demo@123"], ["Admin Demo", "admin", "admin", "Admin@123"], ["Super Admin Demo", "superadmin", "super_admin", "Admin@123"]];
  const users = {};
  for (const [name, key, role, password] of accounts) {
    const email = `${key}@memooria.demo`; await User.updateOne({ email }, { $setOnInsert: { name, email, role, demo: true, password: await bcrypt.hash(password, 12) } }, { upsert: true }); users[key] = await User.findOne({ email });
  }
  const dates = Array.from({ length: 90 }, (_, i) => new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10));
  for (const [key, slug, category] of [["photographer", "demo-kolkata-photographer", "Photography"], ["makeup", "demo-kolkata-makeup", "Makeup Artist"]]) {
    const existing = await Creator.findOne({ category, status: "Active" });
    await Creator.updateOne({ slug }, { $setOnInsert: { user: users[key]._id, slug, businessName: key === "photographer" ? "Kolkata Light Stories" : "Petal Makeup Studio", ownerName: users[key].name, email: users[key].email, category, location: "Kolkata, West Bengal", city: "Kolkata", state: "West Bengal", description: "A fictional demo creative team offering thoughtful, personal service for your celebrations.", status: "Active", applicationStatus: "APPROVED", verified: true, profileImage: existing?.profileImage || "", coverImage: existing?.coverImage || "", gallery: existing?.gallery || [], packages: [{ name: "Per day", price: 15000, description: "Eight hours of service and a planning consultation." }], services: [category], serviceAreas: ["Kolkata"], travelAvailable: true, languages: ["English", "Bengali", "Hindi"], experience: 5, availability: dates, socialLinks: {}, application: { service: category, businessName: key === "photographer" ? "Kolkata Light Stories" : "Petal Makeup Studio", city: "Kolkata", bio: "A fictional demo creative team offering thoughtful, personal service for your celebrations." } } }, { upsert: true });
  }
  const photographer = await Creator.findOne({ slug: "demo-kolkata-photographer" });
  for (const category of categories.filter(c => !["Photography", "Makeup Artist"].includes(c.title))) {
    const email = `${category.slug}@memooria.demo`, slug = `demo-${category.slug}`;
    await User.updateOne({ email }, { $setOnInsert: { name: `${category.title} Demo`, email, role: "creator", demo: true, password: await bcrypt.hash("Demo@123", 12) } }, { upsert: true });
    const owner = await User.findOne({ email }); const reference = await Creator.findOne({ category: category.title, status: "Active" });
    await Creator.updateOne({ slug }, { $setOnInsert: { user: owner._id, slug, businessName: `${category.title} Collective (Demo)`, ownerName: owner.name, email, category: category.title, location: "Kolkata, West Bengal", city: "Kolkata", state: "West Bengal", description: "A fictional demo business for exploring Memooria's managed service workflows.", status: "Active", verified: true, applicationStatus: "APPROVED", profileImage: reference?.profileImage || category.image, coverImage: reference?.coverImage || category.image, gallery: reference?.gallery || [], packages: [{ name: "Per day", price: 10000, description: "A planning consultation and one day of professional service." }], services: [category.title], availability: dates, serviceAreas: ["Kolkata"], travelAvailable: true, socialLinks: {}, application: { service: category.title } } }, { upsert: true });
  }
  await Requirement.updateOne({ title: "Demo: a warm Kolkata wedding", customer: users.customer._id }, { $setOnInsert: { title: "Demo: a warm Kolkata wedding", customer: users.customer._id, event: "Wedding", services: ["Photography"], date: dates[14], startTime: "10:00", endTime: "18:00", city: "Kolkata", budgetMin: 10000, budgetMax: 30000, description: "We are planning an intimate wedding and would love candid photography with warm natural editing.", deadline: dates[7], status: "PENDING_ADMIN_REVIEW", proposalLimit: 10, invited: [] } }, { upsert: true });
  await Booking.updateOne({ title: "Demo: direct wedding request", customer: users.customer._id }, { $setOnInsert: { title: "Demo: direct wedding request", customer: users.customer._id, creator: photographer._id, creatorUser: users.photographer._id, event: "Wedding", service: "Photography", date: dates[15], startTime: "10:00", endTime: "18:00", city: "Kolkata", amount: 15000, commissionRate: 15, commissionAmount: 2250, status: "PENDING_ADMIN_REVIEW", instructions: "Please focus on candid moments with family." } }, { upsert: true });
  await Notification.updateOne({ user: users.customer._id, title: "Welcome to your Memooria demo" }, { $setOnInsert: { user: users.customer._id, title: "Welcome to your Memooria demo", link: "/customer/dashboard" } }, { upsert: true });
  console.log("Marketplace configuration and fictional demo accounts seeded. Enable DEMO_MODE=true to log in.");
}
if (process.argv[1]?.endsWith("seed-marketplace.js")) { await connectDatabase(); await seedMarketplace(); await mongoose.disconnect(); }
