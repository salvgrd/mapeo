import { parseArgs } from "node:util";
import { inArray, notInArray, sql } from "drizzle-orm";
import type { LineString, MultiPolygon, Position } from "geojson";
import { barrios, segments } from "../src/db/schema";
import { connect } from "./db";

const USAGE = `Usage:
  import-osm --relation <district relation id> [--exclude "<street name>"]... [--dry-run] [--prune]

Imports the district's sub-boundaries (admin_level --sub-level, default 10) as
barrios, and its named streets split into segments at every intersection.
Re-running keeps the status of every segment whose OSM way still exists.
--prune deletes segments that are no longer in OSM, with their history.

OSM_RELATION and OSM_EXCLUDE (street names separated by ";") are the defaults
for --relation and --exclude. A flag replaces its variable, it does not add to it.`;

const HIGHWAYS = "^(primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$";
// A tunnel cannot be papered. `!~` also matches ways with no tunnel tag at all.
// Tunnel ramps are often untagged, hence the name check too. Not foot=no: it is
// also on the central carriageways of streets that do have pavements.
const NOT_TUNNEL = '["tunnel"!~"^(yes|building_passage|culvert)$"]';
const TUNNEL_NAME = /^t[uú]nel\b/i;

const { values } = parseArgs({
  options: {
    relation: { type: "string" },
    "sub-level": { type: "string", default: "10" },
    exclude: { type: "string", multiple: true },
    "dry-run": { type: "boolean", default: false },
    prune: { type: "boolean", default: false },
  },
});

const relationId = Number(values.relation ?? process.env.OSM_RELATION);
if (!Number.isInteger(relationId) || relationId <= 0) {
  console.error(USAGE);
  process.exit(1);
}
const areaId = 3600000000 + relationId; // Overpass area ids are relation ids offset by 3.6e9
// ";" because OSM already uses it to separate several values in one tag.
const excluded = new Set(
  values.exclude ?? (process.env.OSM_EXCLUDE ?? "").split(";").map((s) => s.trim()).filter(Boolean),
);

type LatLon = { lat: number; lon: number };
type Way = { type: "way"; id: number; nodes: number[]; tags: Record<string, string>; geometry: LatLon[] };
type Relation = {
  type: "relation";
  id: number;
  tags: Record<string, string>;
  members: { type: string; role: string; geometry?: LatLon[] }[];
};

// The public instance answers 429/502/504 when busy, and asks for backoff.
async function overpass<T>(query: string, attempt = 0): Promise<T[]> {
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "mapeo-import/0.1" },
    body: new URLSearchParams({ data: `[out:json][timeout:120];${query}` }),
  });
  if (res.ok) return ((await res.json()) as { elements: T[] }).elements;
  if (![429, 502, 503, 504].includes(res.status) || attempt >= 5) {
    console.error(`Overpass returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const wait = 5000 * 2 ** attempt;
  console.error(`Overpass busy (${res.status}), retrying in ${wait / 1000}s`);
  await new Promise((r) => setTimeout(r, wait));
  return overpass(query, attempt + 1);
}

const ptKey = (p: LatLon) => `${p.lat},${p.lon}`;

// Joins a boundary relation's outer member ways end to end into closed rings.
function outerRings(rel: Relation): Position[][] {
  const pieces = rel.members
    .filter((m) => m.type === "way" && m.role !== "inner" && m.geometry?.length)
    .map((m) => m.geometry!);
  const rings: Position[][] = [];
  while (pieces.length) {
    const ring = pieces.shift()!.slice();
    while (ptKey(ring[0]) !== ptKey(ring.at(-1)!)) {
      const end = ptKey(ring.at(-1)!);
      const i = pieces.findIndex((p) => ptKey(p[0]) === end || ptKey(p.at(-1)!) === end);
      if (i === -1) break; // unclosed ring: keep what there is
      const [next] = pieces.splice(i, 1);
      ring.push(...(ptKey(next[0]) === end ? next : next.slice().reverse()).slice(1));
    }
    rings.push(ring.map((p) => [p.lon, p.lat]));
  }
  return rings;
}

function inRing([x, y]: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inPolygon = (p: Position, poly: MultiPolygon) => poly.coordinates.some(([outer]) => inRing(p, outer));

function centroid(poly: MultiPolygon): Position {
  const pts = poly.coordinates.flatMap(([outer]) => outer);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

// The point halfway along the line, so a long segment is placed by where most of it lies.
function midpoint(line: Position[]): Position {
  const lens = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
  let half = lens.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (half <= lens[i]) {
      const t = lens[i] ? half / lens[i] : 0;
      return [line[i][0] + t * (line[i + 1][0] - line[i][0]), line[i][1] + t * (line[i + 1][1] - line[i][1])];
    }
    half -= lens[i];
  }
  return line.at(-1)!;
}

// --- boundaries ---

const rels = await overpass<Relation>(
  `rel(id:${relationId});out geom;area(id:${areaId})->.a;` +
    `rel(area.a)["boundary"="administrative"]["admin_level"="${values["sub-level"]}"];out geom;`,
);
const district = rels.find((r) => r.id === relationId);
if (!district) {
  console.error(`Relation ${relationId} not found`);
  process.exit(1);
}
const districtPoly: MultiPolygon = { type: "MultiPolygon", coordinates: outerRings(district).map((r) => [r]) };

// rel(area) also returns neighbours that merely touch the boundary; keep those centred inside it.
const barrioList = rels
  .filter((r) => r.id !== relationId)
  .map((r) => ({
    osmId: r.id,
    name: r.tags.name ?? `Relación ${r.id}`,
    geometry: { type: "MultiPolygon", coordinates: outerRings(r).map((ring) => [ring]) } as MultiPolygon,
  }))
  .filter((b) => inPolygon(centroid(b.geometry), districtPoly))
  .sort((a, b) => a.name.localeCompare(b.name, "es"));

if (barrioList.length === 0) {
  console.error(`No admin_level=${values["sub-level"]} boundaries inside ${district.tags.name}; try another --sub-level`);
  process.exit(1);
}

// --- streets, split at intersections ---

const ways = (
  await overpass<Way>(`area(id:${areaId})->.a;way(area.a)["highway"~"${HIGHWAYS}"]["name"]${NOT_TUNNEL};out geom;`)
).filter((w) => !excluded.has(w.tags.name) && !TUNNEL_NAME.test(w.tags.name));

const uses = new Map<number, number>();
for (const w of ways) for (const n of w.nodes) uses.set(n, (uses.get(n) ?? 0) + 1);

type Seg = { key: string; streetName: string; barrioOsmId: number; geometry: LineString };
const segs: Seg[] = [];
let outside = 0;
for (const w of ways) {
  let start = 0;
  for (let i = 1; i < w.nodes.length; i++) {
    if (i < w.nodes.length - 1 && uses.get(w.nodes[i])! < 2) continue;
    const coords = w.geometry.slice(start, i + 1).map((p) => [p.lon, p.lat]);
    const barrio = barrioList.find((b) => inPolygon(midpoint(coords), b.geometry));
    if (barrio) {
      segs.push({
        key: `${w.id}:${w.nodes[start]}:${w.nodes[i]}`,
        streetName: w.tags.name,
        barrioOsmId: barrio.osmId,
        geometry: { type: "LineString", coordinates: coords },
      });
    } else {
      outside++;
    }
    start = i;
  }
}

console.log(`${district.tags.name}: ${ways.length} ways → ${segs.length} segments (${outside} outside the barrios, dropped)`);
for (const b of barrioList) {
  const mine = segs.filter((s) => s.barrioOsmId === b.osmId);
  console.log(`  ${b.name}: ${mine.length} segments, ${new Set(mine.map((s) => s.streetName)).size} streets`);
}
if (excluded.size) console.log(`  excluded: ${[...excluded].join(", ")}`);
if (values["dry-run"]) process.exit(0);

// --- write ---

const { db, pool } = connect();
await db.transaction(async (tx) => {
  const saved = await tx
    .insert(barrios)
    .values(barrioList)
    .onConflictDoUpdate({ target: barrios.osmId, set: { name: sql`excluded.name`, geometry: sql`excluded.geometry` } })
    .returning({ id: barrios.id, osmId: barrios.osmId });
  const barrioId = new Map(saved.map((b) => [b.osmId, b.id]));

  for (let i = 0; i < segs.length; i += 1000) {
    await tx
      .insert(segments)
      .values(
        segs.slice(i, i + 1000).map((s) => ({
          key: s.key,
          streetName: s.streetName,
          barrioId: barrioId.get(s.barrioOsmId)!,
          geometry: s.geometry,
        })),
      )
      .onConflictDoUpdate({
        target: segments.key,
        set: {
          streetName: sql`excluded.street_name`,
          barrioId: sql`excluded.barrio_id`,
          geometry: sql`excluded.geometry`,
        },
      });
  }

  const keys = segs.map((s) => s.key);
  const stale = await tx.select({ id: segments.id }).from(segments).where(notInArray(segments.key, keys));
  if (stale.length && values.prune) {
    await tx.delete(segments).where(
      inArray(
        segments.id,
        stale.map((s) => s.id),
      ),
    );
    console.log(`pruned ${stale.length} segments no longer in OSM`);
  } else if (stale.length) {
    console.log(`${stale.length} segments in the database are no longer in this import; --prune deletes them`);
  }
});
await pool.end();
console.log("imported");
