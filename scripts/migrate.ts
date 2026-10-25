import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connect } from "./db";

// scripts/ in the repo, scripts/ in the deployed /opt/mapeo: drizzle/ is a sibling in both.
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

const { db, pool } = connect();
await migrate(db, { migrationsFolder });
await pool.end();
console.log("migrations applied");
