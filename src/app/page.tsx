import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { barrios, segments, statusChanges } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import MapApp from "@/components/MapApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Read before the segments: a change landing in between is then both in the
  // page and replayed over /api/events, which is harmless. The other order loses it.
  const [{ lastChangeId }] = await db
    .select({ lastChangeId: sql<number>`coalesce(max(${statusChanges.id}), 0)`.mapWith(Number) })
    .from(statusChanges);

  const [barrioRows, segmentRows, user] = await Promise.all([
    db
      .select({ id: barrios.id, name: barrios.name, geometry: barrios.geometry })
      .from(barrios)
      .orderBy(asc(barrios.name)),
    db
      .select({
        id: segments.id,
        streetName: segments.streetName,
        barrioId: segments.barrioId,
        status: segments.status,
        geometry: segments.geometry,
      })
      .from(segments),
    getCurrentUser(),
  ]);

  return <MapApp barrios={barrioRows} segments={segmentRows} user={user} lastChangeId={lastChangeId} />;
}
