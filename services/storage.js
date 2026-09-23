import { v2 as cloudinary } from "cloudinary";
import { fail } from "./platform.js";
export function configureStorage() { if (!process.env.CLOUDINARY_API_SECRET) fail(503, "Configure Cloudinary to enable file uploads."); cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET }); }
export async function uploadFile(file, folder, privateFile = true) {
  configureStorage();
  const extension = file.originalname.split(".").pop().toLowerCase();
  const resourceType = ["jpg", "jpeg", "png", "webp"].includes(extension) ? "image" : ["mp4", "mov", "mxf"].includes(extension) ? "video" : "raw";
  const result = await new Promise((resolve, reject) => cloudinary.uploader.upload_stream({ folder, resource_type: resourceType, type: privateFile ? "authenticated" : "upload", timeout: 120000 }, (err, result) => err ? reject(err) : resolve(result)).end(file.buffer));
  return { publicId: result.public_id, resourceType, deliveryType: privateFile ? "authenticated" : "upload", format: result.format || extension, ...(!privateFile && { url: result.secure_url }), originalFilename: file.originalname, mimeType: file.mimetype, extension, size: file.size };
}
export function privateLink(asset) { configureStorage(); return cloudinary.utils.private_download_url(asset.publicId, asset.resourceType === "raw" ? "" : asset.format, { resource_type: asset.resourceType, type: asset.deliveryType, expires_at: Math.floor(Date.now() / 1000) + 300, attachment: true }); }
export async function deleteFile(asset) { configureStorage(); return cloudinary.uploader.destroy(asset.publicId, { resource_type: asset.resourceType, type: asset.deliveryType }); }
