import mongoose from "mongoose";
const { Schema, model } = mongoose;
const image = { type: String, default: "" };
export const User = model(
  "User",
  new Schema(
    {
      name: { type: String, required: true },
      email: { type: String, required: true, unique: true, lowercase: true },
      phone: String,
      status: { type: String, default: "ACTIVE" },
      demo: { type: Boolean, default: false },
      authProviders: { type: [Schema.Types.Mixed], default: [{ provider: "local", providerUserId: null }] },
      onboarding: { type: Schema.Types.Mixed, default: {} },
      password: { type: String, required: true, select: false },
      role: { type: String, enum: ["user", "creator", "admin", "super_admin"], default: "user" },
    },
    { timestamps: true },
  ),
);
export const Service = model(
  "Service",
  new Schema(
    {
      title: { type: String, required: true, unique: true },
      slug: { type: String, required: true, unique: true },
      description: String,
      image,
      active: { type: Boolean, default: true },
      sortOrder: { type: Number, default: 0 },
      parentCategory: { type: Schema.Types.ObjectId, ref: "Service" },
      seoTitle: String, seoDescription: String,
      workflow: { type: String, enum: ["DIGITAL", "PHYSICAL", "RENTAL"], default: "DIGITAL" },
      kind: {
        type: String,
        enum: ["category", "service"],
        default: "category",
      },
    },
    { timestamps: true },
  ),
);
const creatorSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", unique: true, sparse: true },
    verified: { type: Boolean, default: false },
    applicationStatus: { type: String, default: "UNDER_REVIEW" },
    reviewReason: String, reviewHistory: [Schema.Types.Mixed], verificationFiles: [String],
    businessType: { type: String, default: "INDIVIDUAL" },
    languages: [String], eventTypes: [String], experience: Number,
    serviceAreas: [String], travelAvailable: { type: Boolean, default: false },
    temporaryLocations: [{ city: String, from: String, until: String }],
    timeSlots: [{ date: String, startTime: String, endTime: String, blocked: Boolean }],
    weeklyHours: [{ weekday: Number, startTime: String, endTime: String }],
    profileViews: { type: Number, default: 0 },
    scheduleLock: { token: String, until: Date },
    application: { type: Schema.Types.Mixed, select: false },
    businessName: { type: String, required: true },
    ownerName: String,
    slug: { type: String, required: true, unique: true },
    profileImage: image,
    coverImage: image,
    email: String,
    phone: String,
    category: { type: String, required: true },
    location: { type: String, required: true },
    city: String,
    state: String,
    description: String,
    services: [String],
    gallery: [String],
    packages: [
      { name: String, price: { type: Number, min: 0 }, description: String, discountPrice: Number, duration: String, includedItems: [String], deliveryTime: String, active: { type: Boolean, default: true }, attributes: Schema.Types.Mixed },
    ],
    availability: [String],
    socialLinks: { instagram: String, facebook: String, website: String },
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    featured: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Pending"],
      default: "Pending",
    },
  },
  { timestamps: true },
);
creatorSchema.index({ status: 1, category: 1, location: 1 });
export const Creator = model("Creator", creatorSchema);
export const Inquiry = model(
  "Inquiry",
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: "User" },
      creator: { type: Schema.Types.ObjectId, ref: "Creator" },
      name: { type: String, required: true },
      email: { type: String, required: true },
      phone: String,
      service: String,
      date: String,
      message: { type: String, required: true },
      status: {
        type: String,
        enum: ["New", "Contacted", "Completed"],
        default: "New",
      },
    },
    { timestamps: true },
  ),
);
export const Review = model(
  "Review",
  new Schema(
    {
      creator: { type: Schema.Types.ObjectId, ref: "Creator", required: true },
      user: { type: Schema.Types.ObjectId, ref: "User", required: true },
      booking: { type: Schema.Types.ObjectId, ref: "Booking" },
      quality: Number, communication: Number, professionalism: Number, value: Number, deliveryTime: Number,
      customer: String,
      rating: { type: Number, min: 1, max: 5, required: true },
      comment: String,
      approved: { type: Boolean, default: false },
    },
    { timestamps: true },
  ).index({ creator: 1, user: 1 }, { unique: true }),
);
export const SiteContent = model(
  "SiteContent",
  new Schema(
    { key: { type: String, unique: true }, value: Schema.Types.Mixed },
    { timestamps: true },
  ),
);

export const Onboarding = model("Onboarding", new Schema({ user: { type: Schema.Types.ObjectId, ref: "User", unique: true, required: true }, answers: { type: Schema.Types.Mixed, default: {} }, uploads: { type: [Schema.Types.Mixed], default: [] }, submitted: { type: Boolean, default: false } }, { timestamps: true }));
