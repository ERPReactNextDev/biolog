// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" }]},
  allowedDevOrigins: ["*.replit.dev", "*.repl.co", "*.worf.replit.dev", "*.kirk.replit.dev", "*.picard.replit.dev", "*.spock.replit.dev", "*.janeway.replit.dev", "*.riker.replit.dev"],

  async headers() {
    return [
      // Service worker must never be cached by the browser itself
      {
        source: "/service-worker.js",
        headers: [
          { key: "Cache-Control",        value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type",         value: "application/javascript" },
          { key: "Service-Worker-Allowed", value: "/" }]},
      // Manifest
      {
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" }]},
      // Security headers for all routes
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          
          { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" }]}];
  }};

export default nextConfig;