import { asc } from "drizzle-orm";
import { db } from "@/db";
import { barrios, segments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import MapApp from "@/components/MapApp";

export const dynamic = "force-dynamic";

export default async function Home() {
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

  return <MapApp barrios={barrioRows} segments={segmentRows} user={user} />;
}
