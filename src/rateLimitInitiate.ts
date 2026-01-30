/**
 * Per-IP rate limit for POST /initiate to prevent name squatting.
 * 10 registrations per hour per IP.
 */

const INITIATE_LIMIT_PER_HOUR = Math.max(0, Number(process.env.INITIATE_RATE_LIMIT_PER_HOUR) || 10);
const WINDOW_MS = 60 * 60 * 1000;

const counts = new Map<string, { count: number; windowStart: number }>();

function getClientIp(req: import("http").IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  const socket = req.socket;
  return socket?.remoteAddress ?? "unknown";
}

export function checkInitiateRateLimit(req: import("http").IncomingMessage): { allowed: boolean; retryAfterSeconds: number } {
  if (INITIATE_LIMIT_PER_HOUR <= 0) return { allowed: true, retryAfterSeconds: 0 };
  const ip = getClientIp(req);
  const now = Date.now();
  let w = counts.get(ip);
  if (!w || now - w.windowStart >= WINDOW_MS) {
    w = { count: 0, windowStart: now };
    counts.set(ip, w);
  }
  if (w.count >= INITIATE_LIMIT_PER_HOUR) {
    const elapsed = now - w.windowStart;
    const retryAfterSeconds = Math.ceil((WINDOW_MS - elapsed) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }
  w.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
