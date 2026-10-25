"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { segments, segmentStatus, statusChanges, type SegmentStatus } from "@/db/schema";
import { destroySession, getCurrentUser } from "@/lib/auth";

export async function setSegmentStatus(segmentId: number, status: SegmentStatus) {
  const user = await getCurrentUser();
  if (!user) throw new Error("No autorizado");
  if (!Number.isInteger(segmentId) || !segmentStatus.enumValues.includes(status)) {
    throw new Error("Petición inválida");
  }

  await db.transaction(async (tx) => {
    const [segment] = await tx
      .select({ status: segments.status })
      .from(segments)
      .where(eq(segments.id, segmentId))
      .for("update");
    if (!segment || segment.status === status) return;

    await tx
      .update(segments)
      .set({ status, updatedAt: new Date(), updatedBy: user.id })
      .where(eq(segments.id, segmentId));
    await tx.insert(statusChanges).values({ segmentId, from: segment.status, to: status, userId: user.id });
  });

  revalidatePath("/");
}

export async function logout() {
  await destroySession();
  redirect("/");
}
