import { eq } from "drizzle-orm";
import { users } from "../src/db/schema";
import { connect } from "./db";

const username = process.argv[2]?.trim().toLowerCase();
if (!username) {
  console.error("Usage: delete-user <username>");
  process.exit(1);
}

// Sessions go with the user (ON DELETE CASCADE); their past edits stay, unattributed.
const { db, pool } = connect();
const deleted = await db.delete(users).where(eq(users.username, username)).returning({ id: users.id });
await pool.end();

if (deleted.length === 0) {
  console.error(`No user ${username}`);
  process.exit(1);
}
console.log(`deleted ${username}`);
