"use client";

import L from "leaflet";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Circle, CircleMarker, Pane, useMap, useMapEvent } from "react-leaflet";

type Fix = { lat: number; lng: number; accuracy: number };

// The user's own position. Browser-only: it lives in this component's state and is never sent to the server.
// Off → tap to start and follow. Following → tap to stop. Panned away → tap to recenter and follow again.
export default function MyLocation({ focusKey }: { focusKey: number }) {
  const map = useMap();
  const [tracking, setTracking] = useState(false);
  const [following, setFollowing] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);

  const [container] = useState(() => {
    const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    L.DomEvent.disableClickPropagation(div);
    return div;
  });

  // Added after the ZoomControl, so it stacks above it in the bottom-right corner.
  useEffect(() => {
    const control = new L.Control({ position: "bottomright" });
    control.onAdd = () => container;
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, container]);

  useEffect(() => {
    if (!tracking) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => {
        // Timeouts and lost signal are transient; the watch keeps trying.
        if (err.code !== err.PERMISSION_DENIED) return;
        setTracking(false);
        alert("No hay permiso para usar tu ubicación. Actívalo en los ajustes del navegador.");
      },
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tracking]);

  useEffect(() => {
    if (!following || !fix) return;
    map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 17));
  }, [map, following, fix]);

  // Dragging, or picking a street or barrio, means the user wants to look elsewhere.
  useMapEvent("dragstart", () => setFollowing(false));
  useEffect(() => setFollowing(false), [focusKey]);

  function toggle() {
    if (tracking && following) {
      setTracking(false);
      setFollowing(false);
      setFix(null);
    } else {
      setTracking(true);
      setFollowing(true);
    }
  }

  const label = !tracking ? "Mostrar mi ubicación" : following ? "Ocultar mi ubicación" : "Centrar en mi ubicación";

  return (
    <>
      {createPortal(
        <a
          href="#"
          role="button"
          title={label}
          aria-label={label}
          aria-pressed={tracking}
          onClick={(e) => {
            e.preventDefault();
            toggle();
          }}
          className="!flex items-center justify-center"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
            <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="3" fill={tracking ? "#2563eb" : "currentColor"} />
            <path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" strokeWidth="2" />
          </svg>
        </a>,
        container,
      )}
      {fix && (
        // Its own pane, so status edits redrawing the streets never paint over the dot.
        <Pane name="myLocation" style={{ zIndex: 450 }}>
          <Circle
            center={[fix.lat, fix.lng]}
            radius={fix.accuracy}
            interactive={false}
            pathOptions={{ color: "#2563eb", weight: 1, opacity: 0.4, fillOpacity: 0.1 }}
          />
          <CircleMarker
            center={[fix.lat, fix.lng]}
            radius={7}
            interactive={false}
            pathOptions={{ color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }}
          />
        </Pane>
      )}
    </>
  );
}
