import { asc, gt } from "drizzle-orm";
import { db } from "@/db";
import { statusChanges } from "@/db/schema";
import { subscribe, type StatusEvent } from "@/lib/live";

export const dynamic = "force-dynamic";

// More missed changes than this and the client reloads instead of replaying.
const MAX_REPLAY = 1000;

// Server-Sent Events: every status change, live. The event id is the
// status_changes id, so EventSource's automatic Last-Event-ID on reconnect
// replays exactly what was missed. `?after=` is the cursor for the first
// connection, which cannot send that header.
export async function GET(req: Request) {
  const after = Number(req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("after"));
  if (!Number.isInteger(after) || after < 0) return new Response("Invalid cursor", { status: 400 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {}
      };
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const send = (e: StatusEvent) =>
        write(`id: ${e.changeId}\ndata: ${JSON.stringify({ segmentId: e.segmentId, status: e.status })}\n\n`);

      // Subscribe before reading the backlog, so nothing committed in between is
      // lost; changes seen in both are sent once.
      let backlogIds: Set<number> | null = new Set();
      const buffered: StatusEvent[] = [];
      let unsubscribe: () => void;
      try {
        unsubscribe = await subscribe((e) => {
          if (!e) return close();
          if (backlogIds) buffered.push(e);
          else send(e);
        });
      } catch {
        return close();
      }
      const ping = setInterval(() => write(": ping\n\n"), 25_000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      req.signal.addEventListener("abort", close);

      write("retry: 3000\n\n");
      const backlog = await db
        .select({ changeId: statusChanges.id, segmentId: statusChanges.segmentId, status: statusChanges.to })
        .from(statusChanges)
        .where(gt(statusChanges.id, after))
        .orderBy(asc(statusChanges.id))
        .limit(MAX_REPLAY + 1);
      if (backlog.length > MAX_REPLAY) {
        write("event: stale\ndata: {}\n\n");
        return close();
      }
      for (const e of backlog) {
        backlogIds.add(e.changeId);
        send(e);
      }
      for (const e of buffered) if (!backlogIds.has(e.changeId)) send(e);
      backlogIds = null;
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
