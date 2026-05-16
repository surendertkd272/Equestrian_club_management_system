import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events stream for the topbar bell. Replaces the topbar's 60s
// polling with a long-lived connection that pushes the unread count when it
// changes. Falls back to polling if the browser drops the SSE connection.
//
// Cadence: server polls Prisma at NOTIF_SSE_POLL_MS (default 10s, clamped
// to [3s, 60s]). On every iteration, if the count changed we emit `unread`;
// otherwise a `:keepalive` comment runs every 30s so the connection survives
// proxy idle-timeouts even when nothing changed.
//
// To budget DB load at scale: with 100 concurrent sessions and a 30s poll,
// that's 200 reads/min — set NOTIF_SSE_POLL_MS=30000 in env if needed.
const POLL_MS = Math.max(3_000, Math.min(60_000, Number(process.env.NOTIF_SSE_POLL_MS ?? "10000")));
const KEEPALIVE_MS = 30_000;

// Per-user connection cap. A misbehaving client (browser bug, leaked tab,
// scripted abuse) could open dozens of SSE connections; each holds a DB
// poll loop and a TCP socket. We cap at MAX_STREAMS_PER_USER and refuse
// extras with 429. The map shrinks as cancel() runs on dropped streams.
const MAX_STREAMS_PER_USER = Math.max(1, Math.min(20, Number(process.env.NOTIF_SSE_MAX_PER_USER ?? "5")));
const openStreams = new Map<string, number>();

function tryOpen(userId: string): boolean {
  const current = openStreams.get(userId) ?? 0;
  if (current >= MAX_STREAMS_PER_USER) return false;
  openStreams.set(userId, current + 1);
  return true;
}
function release(userId: string) {
  const current = openStreams.get(userId) ?? 0;
  if (current <= 1) openStreams.delete(userId);
  else openStreams.set(userId, current - 1);
}

export async function GET() {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });

  if (!tryOpen(session.userId)) {
    return new Response("too many streams", {
      status: 429,
      headers: { "Retry-After": "30" },
    });
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  let released = false;
  let lastCount = -1;
  let lastKeepaliveAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }
      function ping() {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
        lastKeepaliveAt = Date.now();
      }

      try {
        while (!cancelled) {
          const count = await prisma.notification.count({
            where: { userId: session!.userId, readAt: null },
          });
          if (count !== lastCount) {
            send("unread", { count });
            lastCount = count;
            lastKeepaliveAt = Date.now();
          } else if (Date.now() - lastKeepaliveAt >= KEEPALIVE_MS) {
            ping();
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      } catch {
        // Stream errored — close politely.
      } finally {
        try {
          controller.close();
        } catch {}
        if (!released) {
          released = true;
          release(session!.userId);
        }
      }
    },
    cancel() {
      cancelled = true;
      if (!released) {
        released = true;
        release(session!.userId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
