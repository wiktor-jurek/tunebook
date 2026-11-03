import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(731125)");
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.query("SELECT pg_advisory_unlock(731125)");
    client.release();
  }
  console.log("Database migrations complete");
} finally {
  await pool.end();
}
