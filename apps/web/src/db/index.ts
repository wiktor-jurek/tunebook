import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalPool = globalThis as typeof globalThis & { __tunebookPool?: Pool };
export const pool = globalPool.__tunebookPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
if (process.env.NODE_ENV !== "production") globalPool.__tunebookPool = pool;
export const db = drizzle(pool);
