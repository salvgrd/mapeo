import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pool?: Pool };

// On globalThis so that dev hot reloads, and the separate bundles of a
// production build, share one pool instead of opening one each.
const pool = (globalForDb.pool ??= new Pool({ connectionString: process.env.DATABASE_URL }));

// An idle client dies when Postgres restarts. Without a listener, pg rethrows
// that as an uncaught exception; the pool replaces the client on its own.
if (pool.listenerCount("error") === 0) {
  pool.on("error", (err) => console.error("db: idle client lost:", err.message));
}

export const db = drizzle(pool, { schema });
