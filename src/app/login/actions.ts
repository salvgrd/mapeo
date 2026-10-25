"use server";

import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { clearFailures, isLimited, recordFailure } from "@/lib/rate-limit";

export type LoginState = { error?: string };

// Verified against when the username does not exist, so both paths take as long.
let dummyHash: Promise<string> | undefined;

async function clientIp() {
  // Caddy discards client-sent X-Forwarded-For and sets its own, and the app
  // port only accepts Caddy. The last entry is the one Caddy wrote.
  const xff = (await headers()).get("x-forwarded-for");
  return xff?.split(",").at(-1)?.trim() || "local";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "Introduce usuario y contraseña." };

  const keys = [`ip:${await clientIp()}`, `user:${username}`];
  if (keys.some(isLimited)) {
    return { error: "Demasiados intentos. Espera 15 minutos." };
  }

  const [user] = await db.select().from(users).where(eq(users.username, username));
  dummyHash ??= hash("not-a-real-password");
  const ok = await verify(user?.passwordHash ?? (await dummyHash), password);

  if (!user || !ok) {
    keys.forEach(recordFailure);
    return { error: "Usuario o contraseña incorrectos." };
  }

  keys.forEach(clearFailures);
  await createSession(user.id);
  redirect("/");
}
