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

// Without a proxy the client writes X-Forwarded-For itself (Next only fills it
// in when absent), so an IP limit would be trivial to dodge. TRUST_PROXY=1 says
// the app port is reachable only through a proxy that overwrites the header,
// as Caddy does by default: the last entry is then the one the proxy wrote.
async function clientIp() {
  if (process.env.TRUST_PROXY !== "1") return null;
  const xff = (await headers()).get("x-forwarded-for");
  return xff?.split(",").at(-1)?.trim() || null;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "Introduce usuario y contraseña." };

  const ip = await clientIp();
  const keys = [`user:${username}`, ...(ip ? [`ip:${ip}`] : [])];
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
