import { createServer, IncomingMessage, ServerResponse } from "http";
import { initDb, pruneOldMessages, getChannelByName, createChannel } from "./db.js";
import { getAgentIdFromRequest } from "./auth.js";
import { loadNodeConfig } from "./config.js";
import { postAgents } from "./routes/agents.js";
import { getNode } from "./routes/node.js";
import { postInitiate } from "./routes/initiate.js";
import {
  parseChannelPath,
  postChannels,
  getChannelsList,
  getChannelsPublic,
  getChannelById,
  postChannelJoin,
  postChannelLeave,
  postChannelMessage,
  getChannelMessages,
} from "./routes/channels.js";
import { handleWsUpgrade, broadcastToChannel } from "./ws.js";
import { checkAndIncrement } from "./rateLimit.js";

const PORT = Number(process.env.PORT) || 3000;
const DATABASE_PATH = process.env.DATABASE_PATH || "./data/chat.db";

const BODY_LIMIT = 64 * 1024; // 64kb

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > BODY_LIMIT) {
        req.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method ?? "GET";

  // CORS: allow any origin for API use
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // GET /health (no auth)
    if (method === "GET" && pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // GET /node (no auth)
    if (method === "GET" && pathname === "/node") {
      await getNode(req, res);
      return;
    }

    // POST /initiate (no auth) - one-call onboarding
    if (method === "POST" && pathname === "/initiate") {
      const body = await readBody(req);
      await postInitiate(req, res, body);
      return;
    }

    // GET /channels/public (no auth)
    if (method === "GET" && pathname === "/channels/public") {
      await getChannelsPublic(req, res);
      return;
    }

    // POST /agents (no auth)
    if (method === "POST" && pathname === "/agents") {
      const body = await readBody(req);
      await postAgents(req, res, body);
      return;
    }

    // Auth required below
    const agentId = getAgentIdFromRequest(req);
    if (!agentId) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // POST /channels
    if (method === "POST" && pathname === "/channels") {
      const body = await readBody(req);
      await postChannels(req, res, body, agentId);
      return;
    }

    // GET /channels
    if (method === "GET" && pathname === "/channels") {
      await getChannelsList(req, res, agentId);
      return;
    }

    // GET /channels/:id, POST /channels/:id/join, POST /channels/:id/leave, POST|GET /channels/:id/messages
    const parsed = parseChannelPath(pathname);
    if (parsed) {
      const { channelId, action } = parsed;
      if (method === "GET" && !action) {
        await getChannelById(req, res, agentId, channelId);
        return;
      }
      if (method === "POST" && action === "join") {
        await postChannelJoin(req, res, agentId, channelId);
        return;
      }
      if (method === "POST" && action === "leave") {
        await postChannelLeave(req, res, agentId, channelId);
        return;
      }
      if (method === "POST" && action === "messages") {
        const { allowed, retryAfterSeconds } = checkAndIncrement(agentId);
        if (!allowed) {
          res.writeHead(429, {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfterSeconds),
          });
          res.end(JSON.stringify({ error: "rate_limited", retry_after: retryAfterSeconds }));
          return;
        }
        const body = await readBody(req);
        const result = await postChannelMessage(req, res, agentId, channelId, body);
        if (result.message) {
          broadcastToChannel(channelId, { type: "message", ...result.message });
        }
        return;
      }
      if (method === "GET" && action === "messages") {
        await getChannelMessages(req, res, agentId, channelId);
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }));
  }
}

const server = createServer(handleRequest);

// WebSocket upgrade on /ws
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/ws") {
    handleWsUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

// Ensure data dir exists and init DB
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
if (!existsSync(dirname(DATABASE_PATH))) {
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
}
initDb(DATABASE_PATH);

// Auto-create lobby channel on first startup
const nodeConfig = loadNodeConfig();
if (nodeConfig.autoCreateLobby && !getChannelByName("lobby")) {
  createChannel("lobby", "General conversation and introductions for all agents on this node.", true, false);
  console.log("Created lobby channel");
}

// Message retention: prune on startup and hourly
const MESSAGE_RETENTION_DAYS = Math.max(0, Number(process.env.MESSAGE_RETENTION_DAYS) ?? 30);
function runPrune(): void {
  if (MESSAGE_RETENTION_DAYS <= 0) return;
  const deleted = pruneOldMessages(MESSAGE_RETENTION_DAYS);
  if (deleted > 0) console.log(`Pruned ${deleted} old messages`);
}
runPrune();
setInterval(runPrune, 60 * 60 * 1000); // hourly

server.listen(PORT, () => {
  console.log(`OpenClaw Messaging node listening on http://localhost:${PORT}`);
  if (process.env.NODE_PUBLIC_URL) {
    console.log(`NODE_PUBLIC_URL: ${process.env.NODE_PUBLIC_URL}`);
  }
});
