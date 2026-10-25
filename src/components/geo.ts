import type { LineString, MultiPolygon } from "geojson";

export type LatLng = [number, number];

export const lineLatLngs = (g: LineString): LatLng[] => g.coordinates.map(([lon, lat]) => [lat, lon]);

export const outerRingLatLngs = (g: MultiPolygon): LatLng[][] =>
  g.coordinates.map(([outer]) => outer.map(([lon, lat]) => [lat, lon] as LatLng));
