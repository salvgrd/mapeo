"use client";

import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Polygon, Polyline, TileLayer, useMap, ZoomControl } from "react-leaflet";
import { STATUS_META } from "@/lib/status";
import { lineLatLngs, outerRingLatLngs } from "./geo";
import type { Focus } from "./MapApp";
import type { Barrio, Segment } from "./types";

// A wide click tolerance, or short segments are near-impossible to tap on a phone.
const renderer = L.canvas({ tolerance: 10 });

type Props = {
  barrios: Barrio[];
  barrioId: number | null;
  segments: Segment[];
  highlighted: Segment[];
  selectedSegmentId: number | null;
  onSelectSegment: (id: number) => void;
  focus: Focus;
};

export default function StreetMap({
  barrios,
  barrioId,
  segments,
  highlighted,
  selectedSegmentId,
  onSelectSegment,
  focus,
}: Props) {
  const outlines = useMemo(() => barrios.map((b) => ({ id: b.id, rings: outerRingLatLngs(b.geometry) })), [barrios]);

  return (
    <MapContainer
      center={[40.46, -3.7]}
      zoom={14}
      renderer={renderer}
      zoomControl={false}
      className="h-full w-full"
    >
      {/* Top-left is taken by the barrio and status filters. */}
      <ZoomControl position="bottomright" />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {outlines.map(({ id, rings }) => (
        <Polygon
          key={id}
          positions={rings}
          interactive={false}
          pathOptions={
            id === barrioId
              ? { color: "#171717", weight: 3, fill: false }
              : { color: "#525252", weight: 1.5, dashArray: "6 6", fill: false, opacity: barrioId === null ? 0.7 : 0.35 }
          }
        />
      ))}
      {segments.map((s) => (
        <Polyline
          key={s.id}
          positions={lineLatLngs(s.geometry)}
          pathOptions={{ color: STATUS_META[s.status].color, weight: 5, opacity: 0.85 }}
          eventHandlers={{ click: () => onSelectSegment(s.id) }}
        />
      ))}
      {highlighted.map((s) => (
        <Polyline
          key={`hl-${s.id}`}
          positions={lineLatLngs(s.geometry)}
          interactive={false}
          pathOptions={{ color: "#171717", weight: s.id === selectedSegmentId ? 13 : 10, opacity: 0.9 }}
        />
      ))}
      {highlighted.map((s) => (
        <Polyline
          key={`hl-top-${s.id}`}
          positions={lineLatLngs(s.geometry)}
          eventHandlers={{ click: () => onSelectSegment(s.id) }}
          pathOptions={{ color: STATUS_META[s.status].color, weight: 6, opacity: 1 }}
        />
      ))}
      <FocusOn focus={focus} />
    </MapContainer>
  );
}

function FocusOn({ focus }: { focus: Focus }) {
  const map = useMap();

  // Keyed on focus.key: a status edit re-renders with the same focus and must not move the map.
  useEffect(() => {
    if (!focus.points.length) return;
    const bounds = L.latLngBounds(focus.points);
    if (focus.animate) map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 18, duration: 0.6 });
    else map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, focus.key]);

  return null;
}
