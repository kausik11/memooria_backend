import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDatabase } from "./config/database.js";
import { Creator, Service, User, Review, SiteContent, Inquiry } from "./models/index.js";
import { refreshRating } from "./controllers/creators.js";
const photo = (id, w = 1200) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=85`;
const photos = {
  wedding: photo("photo-1519741497674-611481863552"),
  couple: photo("photo-1537633552985-df8429e8048b"),
  flowers: photo("photo-1519225421980-715cb0215aed"),
  makeup: photo("photo-1487412947147-5cebf100ffc2"),
  henna: photo("photo-1597157639073-69284dc0fdaf"),
  camera: photo("photo-1516035069371-29a1b244cc32"),
  studio: photo("photo-1598488035139-bdbb2231ce04"),
  party: photo("photo-1511795409834-ef04bbd61622"),
};
export async function seed() {
  const categories = [
    [
      "Photography",
      "Thoughtful photography for weddings, celebrations, and the moments in between.",
      photos.couple,
    ],
    [
      "Makeup Artist",
      "Artistry that lets your natural beauty shine on your special day.",
      photos.makeup,
    ],
    [
      "Mehendi Artist",
      "Intricate, personal designs for traditions worth celebrating.",
      photos.henna,
    ],
    [
      "Videography",
      "Cinematic stories to relive for a lifetime.",
      photos.wedding,
    ],
    [
      "Camera Rental",
      "Professional cameras and lenses for your next creative project.",
      photos.camera,
    ],
    [
      "Event Decoration",
      "Beautiful spaces, thoughtful details, and unforgettable celebrations.",
      photos.flowers,
    ],
    [
      "Studio Rental",
      "A beautifully equipped space to bring your ideas to life.",
      photos.studio,
    ],
    [
      "Wedding Planner",
      "Your perfect day, thoughtfully planned from start to finish.",
      photos.party,
    ],
  ];
  for (const [title, description, image] of categories)
    await Service.updateOne(
      { title },
      {
        $setOnInsert: {
          title,
          description,
          image,
          slug: title.toLowerCase().replaceAll(" ", "-"),
          kind: "category",
        },
      },
      { upsert: true },
    );
  const entries = [
    [
      "The Wedding Frame",
      "Arjun Sen",
      "Photography",
      "Kolkata",
      "West Bengal",
      photos.couple,
      25000,
    ],
    [
      "Blush by Aanya",
      "Aanya Kapoor",
      "Makeup Artist",
      "Mumbai",
      "Maharashtra",
      photos.makeup,
      12000,
    ],
    [
      "Stories by Rohan",
      "Rohan Mehta",
      "Videography",
      "Delhi",
      "Delhi",
      photos.wedding,
      35000,
    ],
    [
      "The Marigold Co.",
      "Meera Rao",
      "Event Decoration",
      "Bangalore",
      "Karnataka",
      photos.flowers,
      45000,
    ],
    [
      "Henna & Harmony",
      "Sana Ali",
      "Mehendi Artist",
      "Kolkata",
      "West Bengal",
      photos.henna,
      5000,
    ],
    [
      "Borrow a Lens",
      "Kabir Shah",
      "Camera Rental",
      "Mumbai",
      "Maharashtra",
      photos.camera,
      1500,
    ],
    [
      "Daylight Studio",
      "Riya Das",
      "Studio Rental",
      "Kolkata",
      "West Bengal",
      photos.studio,
      2500,
    ],
    [
      "Ever After Events",
      "Priya Nair",
      "Wedding Planner",
      "Delhi",
      "Delhi",
      photos.party,
      60000,
    ],
  ];
  const availability = Array.from({ length: 90 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + i + 1);
    return d.toISOString().slice(0, 10);
  }).filter((_, i) => i % 7 !== 0);
  for (const [
    businessName,
    ownerName,
    category,
    city,
    state,
    coverImage,
    price,
  ] of entries) {
    const slug = businessName
      .toLowerCase()
      .replaceAll(/[^a-z0-9 ]/g, "")
      .replaceAll(" ", "-");
    await Creator.updateOne(
      { slug },
      {
        $setOnInsert: {
          slug,
          businessName,
          ownerName,
          category,
          city,
          state,
          location: `${city}, India`,
          email: `${slug}@example.com`,
          phone: "+91 90000 00000",
          coverImage,
          profileImage: coverImage,
          description: `At ${businessName}, we believe the most beautiful moments are the ones that feel like you. Based in ${city}, we bring a thoughtful, personal approach to every celebration.\n\nFrom our very first conversation to the finishing touches, we take time to understand your story. Our team blends years of craft with a love for honest details, warm connections, and work you will treasure long after the day is over.`,
          services: [
            category,
            "Personal consultation",
            "Custom event packages",
            "Destination events",
          ],
          gallery: [coverImage, photos.flowers, photos.couple, photos.wedding],
          packages: [
            {
              name: "Basic",
              price,
              description:
                "A thoughtful introduction. Includes a planning consultation and essential services.",
            },
            {
              name: "Premium",
              price: price * 2,
              description:
                "More time, more details. Extended coverage and a dedicated creative team.",
            },
            {
              name: "Luxury",
              price: price * 3,
              description:
                "The complete experience. Bespoke planning and our most comprehensive service.",
            },
          ],
          availability,
          socialLinks: { instagram: "", facebook: "", website: "" },
          status: "Active",
          featured:
            entries.indexOf(entries.find((e) => e[0] === businessName)) < 4,
        },
      },
      { upsert: true },
    );
  }
  await SiteContent.updateOne(
    { key: "homepage" },
    {
      $setOnInsert: {
        value: {
          slides: [
            { image: photos.wedding, label: "THE WEDDING CHAPTER" },
            { image: photos.makeup, label: "A MOMENT OF BEAUTY" },
            { image: photos.henna, label: "TRADITIONS, REIMAGINED" },
            { image: photos.camera, label: "TOOLS FOR YOUR STORY" },
            { image: photos.party, label: "CELEBRATE TOGETHER" },
          ],
          gallery: [
            photos.couple,
            photos.flowers,
            photos.wedding,
            photos.makeup,
          ],
        },
      },
    },
    { upsert: true },
  );
  const customers = [
    [
      "Ananya & Rahul",
      "Every little moment was captured so beautifully. Looking at our photos feels like living our wedding day all over again.",
    ],
    [
      "Ishita Sharma",
      "From the first conversation, I knew I was in good hands. A warm, thoughtful experience from beginning to end.",
    ],
    [
      "Rhea & Arnav",
      "They understood our vision and brought it to life with so much care. We couldn’t have asked for a more beautiful day.",
    ],
  ];
  const creators = await Creator.find({
    slug: { $in: entries.map(([name]) => name.toLowerCase().replaceAll(/[^a-z0-9 ]/g, "").replaceAll(" ", "-")) },
  }).sort({ slug: 1 });
  for (let i = 0; i < creators.length; i++) {
    const customerIndex = i % customers.length;
    const [name, comment] = customers[customerIndex];
    let user = await User.findOne({ email: `sample${customerIndex}@example.com` });
    if (!user)
      user = await User.create({
        name,
        email: `sample${customerIndex}@example.com`,
        password: await bcrypt.hash(crypto.randomUUID(), 12),
      });
    await Review.updateOne(
      { user: user._id, creator: creators[i]._id },
      {
        $setOnInsert: {
          user: user._id,
          creator: creators[i]._id,
          customer: name,
          rating: i % 2 === 0 ? 5 : 4,
          comment,
          approved: i % 3 !== 2,
        },
      },
      { upsert: true },
    );
    await refreshRating(creators[i]._id);
    await Inquiry.updateOne(
      { email: user.email, creator: creators[i]._id, message: `[Sample] Please share a quote for ${creators[i].category.toLowerCase()} at our celebration.` },
      { $setOnInsert: {
        user: user._id,
        creator: creators[i]._id,
        name,
        email: user.email,
        phone: "+91 90000 00000",
        service: creators[i].category,
        date: creators[i].availability.find((date) => date >= availability[0]),
        message: `[Sample] Please share a quote for ${creators[i].category.toLowerCase()} at our celebration.`,
        status: ["New", "Contacted", "Completed"][i % 3],
      } },
      { upsert: true },
    );
  }
  await Inquiry.updateOne(
    { email: "general-inquiry@example.com", message: "[Sample] Please help us choose a team for a family celebration." },
    { $setOnInsert: {
      name: "Sample Customer",
      email: "general-inquiry@example.com",
      phone: "+91 90000 00000",
      service: "Event planning consultation",
      message: "[Sample] Please help us choose a team for a family celebration.",
      status: "New",
    } },
    { upsert: true },
  );
  for (const status of ["Pending", "Inactive"]) {
    const slug = `sample-${status.toLowerCase()}-studio`;
    await Creator.updateOne({ slug }, { $setOnInsert: {
      slug, businessName: `Sample ${status} Studio`, ownerName: "Sample Owner",
      category: "Photography", location: "Kolkata, India", city: "Kolkata", state: "West Bengal",
      email: `${slug}@example.com`, description: `Fictional studio for testing the ${status.toLowerCase()} status.`,
      status, coverImage: photos.camera, profileImage: photos.camera,
      packages: [{ name: "Basic", price: 10000, description: "Sample photography package" }],
      availability,
    } }, { upsert: true });
  }
  await Service.updateOne({ slug: "sample-event-consultation" }, { $setOnInsert: {
    slug: "sample-event-consultation", title: "Event planning consultation",
    description: "Sample consultation service for planning your celebration.",
    image: photos.party, kind: "service",
  } }, { upsert: true });
  if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) {
    if (process.env.SEED_ADMIN_PASSWORD.length < 10)
      throw new Error("Admin password must contain at least 10 characters.");
    await User.updateOne(
      { email: process.env.SEED_ADMIN_EMAIL.toLowerCase() },
      {
        $setOnInsert: {
          name: "Memooria Admin",
          email: process.env.SEED_ADMIN_EMAIL.toLowerCase(),
          password: await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD, 12),
          role: "admin",
        },
      },
      { upsert: true },
    );
  }
  console.log(
    "Sample content seeded without overwriting existing records. Sample businesses and reviews are fictional.",
  );
}
if (process.argv[1]?.endsWith("seed.js")) {
  await connectDatabase();
  await seed();
  await mongoose.disconnect();
  process.exit(0);
}
