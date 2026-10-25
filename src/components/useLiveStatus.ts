"use client";

import { useCallback, useEffect, useState } from "react";
import type { SegmentStatus } from "@/db/schema";

export type Connection = "connecting" | "live" | "offline";

// Statuses changed since the page was rendered, by segment id. `after` is the
// last status_changes id the page already includes.
export function useLiveStatus(after: number) {
  const [live, setLive] = useState<Map<number, SegmentStatus>>(() => new Map());
  const [connection, setConnection] = useState<Connection>("connecting");

  const apply = useCallback((segmentId: number, status: SegmentStatus) => {
    setLive((m) => (m.get(segmentId) === status ? m : new Map(m).set(segmentId, status)));
  }, []);

  useEffect(() => {
    const es = new EventSource(`/api/events?after=${after}`);
    es.onopen = () => setConnection("live");
    // EventSource retries on its own; this only reflects the gap.
    es.onerror = () => setConnection("offline");
    es.onmessage = (e) => {
      const { segmentId, status } = JSON.parse(e.data) as { segmentId: number; status: SegmentStatus };
      apply(segmentId, status);
    };
    es.addEventListener("stale", () => window.location.reload());
    return () => es.close();
  }, [after, apply]);

  return { live, apply, connection };
}
