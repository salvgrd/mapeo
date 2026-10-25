import "server-only";
import { Client } from "pg";
import type { SegmentStatus } from "@/db/schema";

export const CHANNEL = "segment_status";

export type StatusEvent = { changeId: number; segmentId: number; status: SegmentStatus };

// null means the listener connection dropped: subscribers should close, so that
// browsers reconnect and replay what they missed from status_changes.
type Listener = (event: StatusEvent | null) => void;

type Hub = { listeners: Set<Listener>; client?: Promise<Client>; stopping: boolean };

// On globalThis because the route handler and the server action are separate
// bundles, each with its own copy of this module.
const g = globalThis as unknown as { mapeoHub?: Hub };
const hub =
  g.mapeoHub ??
  (g.mapeoHub = (() => {
    const h: Hub = { listeners: new Set(), stopping: false };
    // The LISTEN connection and the open streams would otherwise keep the
    // process alive after SIGTERM until systemd kills it, 90 s per restart.
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        h.stopping = true;
        for (const l of h.listeners) l(null);
        h.client?.then((c) => c.end()).catch(() => {});
      });
    }
    return h;
  })());

function listen() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const ready = (async () => {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    return client;
  })();
  // A dying client emits both "error" and "end", the second possibly after its
  // replacement exists: only the current client may reset the hub.
  const drop = () => {
    if (hub.client !== ready) return;
    hub.client = undefined;
    for (const l of hub.listeners) l(null);
  };
  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    const event = JSON.parse(msg.payload) as StatusEvent;
    for (const l of hub.listeners) l(event);
  });
  client.on("error", (err) => {
    console.error("live: listener connection lost:", err.message);
    drop();
    client.end().catch(() => {});
  });
  client.on("end", drop);
  return ready;
}

export async function subscribe(listener: Listener) {
  if (hub.stopping) throw new Error("Shutting down");
  hub.listeners.add(listener);
  const ready = (hub.client ??= listen());
  try {
    await ready;
  } catch (err) {
    if (hub.client === ready) hub.client = undefined;
    hub.listeners.delete(listener);
    throw err;
  }
  return () => hub.listeners.delete(listener);
}
