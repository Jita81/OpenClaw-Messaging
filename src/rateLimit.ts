/**
 * Per-agent rate limit: max messages per minute.
 * In-memory counter, reset every minute. No Redis.
 */

const RATE_LIMIT_PER_MINUTE = Math.max(0, Number(process.env.RATE_LIMIT_PER_MINUTE) || 60);

const counts = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;

function getWindow(agentId: string): { count: number; windowStart: number } {
  const now = Date.now();
  let w = counts.get(agentId);
  if (!w || now - w.windowStart >= WINDOW_MS) {
    w = { count: 0, windowStart: now };
    counts.set(agentId, w);
  }
  return w;
}

/** Returns true if the agent is under the limit (and increments). Returns false if over limit (does not increment). */
export function checkAndIncrement(agentId: string): { allowed: boolean; retryAfterSeconds: number } {
  if (RATE_LIMIT_PER_MINUTE <= 0) return { allowed: true, retryAfterSeconds: 0 };
  const w = getWindow(agentId);
  if (w.count >= RATE_LIMIT_PER_MINUTE) {
    const elapsed = Date.now() - w.windowStart;
    const retryAfterSeconds = Math.ceil((WINDOW_MS - elapsed) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }
  w.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function getLimit(): number {
  return RATE_LIMIT_PER_MINUTE;
}
