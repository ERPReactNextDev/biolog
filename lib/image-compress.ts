// lib/image-compress.ts
// Compress a base64 image before storing in the offline queue.
// Reduces a 5MP photo from ~3-5MB to ~150-300KB.

const MAX_WIDTH  = 1024;
const MAX_HEIGHT = 1024;
const QUALITY    = 0.75;

/**
 * Compress a base64 image string.
 * Returns a compressed base64 JPEG string.
 * Falls back to the original if canvas is unavailable (SSR / Node).
 */
export async function compressImage(base64: string): Promise<string> {
  if (typeof document === "undefined") return base64; // SSR guard

  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      let { width, height } = img;

      // Scale down proportionally
      if (width > MAX_WIDTH || height > MAX_HEIGHT) {
        const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(base64); return; }

      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL("image/jpeg", QUALITY);
      resolve(compressed);
    };

    img.onerror = () => resolve(base64); // fallback on error
    img.src = base64;
  });
}

/** Returns size in KB of a base64 string */
export function base64SizeKB(base64: string): number {
  const base64Data = base64.split(",")[1] ?? base64;
  return Math.round((base64Data.length * 3) / 4 / 1024);
}
