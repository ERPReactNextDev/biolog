// lib/MongoDB.ts
// WARNING: MongoDB is no longer used in this application.
// This file is kept as a placeholder to prevent import errors during transition.
// All database operations have been migrated to Supabase.

export async function connectToDatabase() {
  throw new Error("MongoDB is no longer supported. Please use Supabase instead.");
}

export async function validateUser() {
  throw new Error("MongoDB is no longer supported. Please use Supabase instead.");
}

export async function registerUser() {
  throw new Error("MongoDB is no longer supported. Please use Supabase instead.");
}

const clientPromise = Promise.reject(new Error("MongoDB client is disabled."));
export default clientPromise;
