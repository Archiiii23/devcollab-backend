import "dotenv/config";
import { connectDb } from "./db.js";
import { ensureDemoUser, seedIfEmpty } from "./seed.js";

(async () => {
  await connectDb();
  const a = await seedIfEmpty();
  const b = await ensureDemoUser();
  console.log("Seed:", a);
  console.log("Demo user:", b);
  process.exit(0);
})().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
