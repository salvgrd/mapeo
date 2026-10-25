import { createInterface } from "node:readline";
import { hash } from "@node-rs/argon2";
import { users } from "../src/db/schema";
import { connect } from "./db";

const username = process.argv[2]?.trim().toLowerCase();
if (!username) {
  console.error("Usage: create-user <username>   (password read from stdin)");
  process.exit(1);
}

function readPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  if (process.stdin.isTTY) {
    process.stdout.write("Password: ");
    // Echo nothing while the password is typed.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
  }
  return new Promise((resolve) =>
    rl.once("line", (line) => {
      rl.close();
      if (process.stdin.isTTY) process.stdout.write("\n");
      resolve(line);
    }),
  );
}

const password = await readPassword();
if (password.length < 10) {
  console.error("Password must be at least 10 characters");
  process.exit(1);
}

const { db, pool } = connect();
const inserted = await db
  .insert(users)
  .values({ username, passwordHash: await hash(password) })
  .onConflictDoNothing()
  .returning({ id: users.id });
await pool.end();

if (inserted.length === 0) {
  console.error(`User ${username} already exists`);
  process.exit(1);
}
console.log(`created ${username}`);
