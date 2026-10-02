/* ============================================================================
   Image storage — Supabase Storage first, Cloudinary as the fallback
   ----------------------------------------------------------------------------
   WHY THERE IS A FALLBACK
   The OB spec calls for Supabase Storage, but this project has never used it:
   every existing image (site-visit photos, attendance proof) goes to Cloudinary
   through lib/cloudinary.ts with the unsigned "biolog" preset. Supabase buckets
   are created by hand in the dashboard and the app only holds the *anon* key, so
   assuming the bucket exists would make OB submission fail on a fresh install.

   So: try the Supabase bucket, and if it is not there (or the upload is
   refused), fall back to Cloudinary and say so. Create the bucket using
   supabase/migrations/20260102_ob_requests.sql STEP 3 and OB images will start
   landing in Supabase with no code change.

   Both providers return a plain HTTPS URL, so the two are interchangeable from
   the caller's point of view and `PhotoURL` holds a mix during the transition —
   the viewer only ever treats it as string[].
   ========================================================================== */

import { supabase } from "./supabase";
import { uploadToCloudinary } from "./cloudinary";

export const OB_BUCKET = "ob-requests";

export type StorageProvider = "supabase" | "cloudinary";

export type UploadResult = {
  url: string;
  provider: StorageProvider;
};

let lastFailure: string | null = null;

/** Why Supabase was skipped last time, for the console + a diagnostic toast. */
export function storageFallbackReason(): string | null {
  return lastFailure;
}

/** base64 data URL → Blob, without assuming the mime type is exactly image/jpeg. */
function dataUrlToBlob(dataUrl: string): Blob {
  // [\s\S] rather than the /s flag: this project targets pre-ES2018, and a
  // base64 payload must survive line-wrapped input anyway.
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error("Not a data URL");

  const mime = match[1] || "image/jpeg";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";

  if (!isBase64) {
    return new Blob([decodeURIComponent(payload)], { type: mime });
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function extensionFor(mime?: string): string {
  if (!mime) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("heic") || mime.includes("heif")) return "heic";
  return "jpg";
}

/**
 * Object path. Scoped per company and per employee so the bucket stays legible
 * when someone browses it, and so a future per-tenant storage policy has an
 * obvious prefix to match on.
 */
function buildPath(opts: { companyId?: number | string | null; referenceId?: string | null; index?: number }) {
  const parts = [
    "ob-requests",
    opts.companyId ? `company-${opts.companyId}` : "company-unset",
    (opts.referenceId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_"),
  ];
  return parts.join("/");
}

/**
 * Upload one image.
 *
 * @param dataUrl  base64 data URL (what compressImage returns)
 * @param opts     identity used to build the storage path
 * @returns        the public URL and which provider actually served it
 */
export async function uploadObImage(
  dataUrl: string,
  opts: { companyId?: number | string | null; referenceId?: string | null; index?: number; mimeType?: string } = {}
): Promise<UploadResult> {
  const index = opts.index ?? 0;

  if (typeof window === "undefined") {
    throw new Error("uploadObImage must run in the browser");
  }

  // ── Attempt 1: Supabase Storage ──────────────────────────────────────────
  if (supabase) {
    try {
      const blob = dataUrlToBlob(dataUrl);
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const path = `${buildPath(opts)}/${stamp}-${index}.${extensionFor(opts.mimeType || blob.type)}`;

      const { error } = await supabase.storage.from(OB_BUCKET).upload(path, blob, {
        cacheControl: "31536000", // one year — these are immutable records
        upsert: false,
        contentType: blob.type || "image/jpeg",
      });

      if (error) {
        // "Bucket not found" lands here on any install that has not run the
        // bucket SQL yet. Not fatal — that is exactly what the fallback is for.
        lastFailure = error.message || "Supabase upload refused";
        console.warn(`[storage] Supabase upload failed (${lastFailure}); falling back to Cloudinary.`);
      } else {
        const { data } = supabase.storage.from(OB_BUCKET).getPublicUrl(path);
        const url = data?.publicUrl;
        if (url) {
          lastFailure = null;
          return { url, provider: "supabase" };
        }
        lastFailure = "Supabase returned no public URL";
      }
    } catch (err: any) {
      lastFailure = err?.message || "Supabase upload threw";
      console.warn(`[storage] Supabase upload threw (${lastFailure}); falling back to Cloudinary.`);
    }
  } else {
    lastFailure = "Supabase client is not configured";
  }

  // ── Attempt 2: Cloudinary (matches every other image in this app) ────────
  const url = await uploadToCloudinary(dataUrl);
  return { url, provider: "cloudinary" };
}

/** Upload several images sequentially, preserving order. */
export async function uploadObImages(
  dataUrls: string[],
  opts: { companyId?: number | string | null; referenceId?: string | null } = {}
): Promise<UploadResult[]> {
  const out: UploadResult[] = [];
  for (let i = 0; i < dataUrls.length; i += 1) {
    out.push(await uploadObImage(dataUrls[i], { ...opts, index: i }));
  }
  return out;
}