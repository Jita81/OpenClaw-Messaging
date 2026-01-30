import { createHash, randomUUID } from "crypto";
import { IncomingMessage } from "http";
import { getAgentByApiKeyHash } from "./db.js";

const API_KEY_HEADER = (process.env.API_KEY_HEADER || "authorization").toLowerCase();

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

export function generateApiKey(): string {
  return "claw_" + randomUUID().replace(/-/g, "") + "_" + Math.random().toString(36).slice(2, 12);
}

/** Returns raw API key from request, or null. Uses Authorization Bearer or custom header (e.g. X-Api-Key). */
function getApiKeyFromRequest(req: IncomingMessage): string | null {
  const raw = req.headers[API_KEY_HEADER] ?? req.headers["authorization"];
  if (typeof raw !== "string") return null;
  if (API_KEY_HEADER !== "authorization") return raw.trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : raw.trim();
}

/**
 * Resolve raw API key to agent_id. Use for WebSocket query param auth.
 */
export function getAgentIdFromToken(token: string): string | null {
  const hash = hashApiKey(token);
  const agent = getAgentByApiKeyHash(hash);
  return agent ? agent.id : null;
}

/**
 * Resolve request to agent_id if valid API key. Returns agent id or null (unauthorized).
 */
export function getAgentIdFromRequest(req: IncomingMessage): string | null {
  const token = getApiKeyFromRequest(req);
  if (!token) return null;
  return getAgentIdFromToken(token);
}
