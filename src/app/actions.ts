"use server";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { segments, segmentStatus, statusChanges, type SegmentStatus } from "@/db/schema";
import { destroySession, getCurrentUser } from "@/lib/auth";
import { CHANNEL, type StatusEvent } from "@/lib/live";

// No revalidatePath: the editor applies the result itself, and every other
// client hears it over /api/events, which is far less than a full page payload.
export async function setSegmentStatus(segmentId: number, status: SegmentStatus) {
  const user = await getCurrentUser();
  if (!user) throw new Error("No autorizado");
  if (!Number.isInteger(segmentId) || !segmentStatus.enumValues.includes(status)) {
    throw new Error("Petición inválida");
  }

  return db.transaction(async (tx) => {
    const [segment] = await tx
      .select({ status: segments.status })
      .from(segments)
      .where(eq(segments.id, segmentId))
      .for("update");
    if (!segment) throw new Error("Tramo inexistente");
    if (segment.status === status) return { segmentId, status };

    await tx
      .update(segments)
      .set({ status, updatedAt: new Date(), updatedBy: user.id })
      .where(eq(segments.id, segmentId));
    const [change] = await tx
      .insert(statusChanges)
      .values({ segmentId, from: segment.status, to: status, userId: user.id })
      .returning({ id: statusChanges.id });
    // Delivered to listeners only if this transaction commits.
    const event: StatusEvent = { changeId: change.id, segmentId, status };
    await tx.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(event)})`);
    return { segmentId, status };
  });
}

export async function logout() {
  await destroySession();
  redirect("/");
}
