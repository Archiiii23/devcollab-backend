import mongoose, { type Mongoose } from "mongoose";

// In a serverless environment every function invocation is a fresh process,
// but Node module caching DOES persist across invocations within the same
// container. We cache the connection on globalThis so concurrent invocations
// share a single mongoose instance.
declare global {
  var __mongoose:
    | { conn: Mongoose | null; promise: Promise<Mongoose> | null }
    | undefined;
}

const cache = globalThis.__mongoose ?? { conn: null, promise: null };
globalThis.__mongoose = cache;

export async function connectDb(): Promise<Mongoose> {
  if (cache.conn) return cache.conn;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is required");
  }
  if (!cache.promise) {
    mongoose.set("strictQuery", true);
    cache.promise = mongoose.connect(uri, {
      // Keep connection pool tight on serverless
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
