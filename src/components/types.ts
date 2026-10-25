import type { LineString, MultiPolygon } from "geojson";
import type { SegmentStatus } from "@/db/schema";

export type Segment = {
  id: number;
  streetName: string;
  barrioId: number;
  status: SegmentStatus;
  geometry: LineString;
};

export type Barrio = {
  id: number;
  name: string;
  geometry: MultiPolygon;
};
