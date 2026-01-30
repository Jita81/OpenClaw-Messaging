/**
 * Bridge: mesh peer + legacy REST/WS API. Legacy clients use POST /initiate, /ws, /channels/:id/messages;
 * bridge translates to mesh (subscribe, publishMessage, getStoredMessages).
 * Run: BRIDGE_PORT=3000 MESH_PEER_PORT=5000 MESH_BOOTSTRAP_URL=http://localhost:4000/bootstrap.json node dist/mesh/runBridge.js
 * Optional: MESH_KEY_DIR=./data/mesh-keys for Ed25519 keypair (peer_id and signing).
 */
import { createServer, IncomingMessage, ServerResponse } from "http";
import WebSocket from "ws";
import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";
import { createMeshPeer } from "./peer.js";
import { loadOrCreateKeypair, publicKeyToPeerId } from "./identity.js";
import { generateApiKey } from "../auth.js";
import type { MeshMessage } from "./meshStore.js";

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT) || 3000;
const MESH_PEER_PORT = Number(process.env.MESH_PEER_PORT) || 5000;
const HOST = process.env.HOST ?? "0.0.0.0";
const BOOTSTRAP_URL = process.env.MESH_BOOTSTRAP_URL ?? "http://localhost:4000/bootstrap.json";
const MESH_STORE_PATH = process.env.MESH_STORE_PATH ?? "./data/mesh.db";
const MESH_KEY_DIR = process.env.MESH_KEY_DIR ?? "";
const BRIDGE_PUBLIC_URL = process.env.NODE_PUBLIC_URL ?? `http://localhost:${BRIDGE_PORT}`;

let bridgePeerId: string;
let keypair: { publicKey: string; privateKey: string } | null = null;
if (MESH_KEY_DIR) {
  keypair = loadOrCreateKeypair(MESH_KEY_DIR);
  bridgePeerId = publicKeyToPeerId(keypair.publicKey);
} else {
  bridgePeerId = `bridge-${randomUUID().slice(0, 8)}`;
}

const agentsByKey = new Map<string, string>();
const agentsByName = new Map<string, string>();

function getAgentIdFromRequest(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const apiKey = url.searchParams.get("api_key") ?? req.headers.authorization?.replace(/^Bearer\s+/i, "")?.trim();
  if (!apiKey) return null;
  return agentsByKey.get(apiKey) ?? null;
}

function json(res: ServerResponse, status: number, data: object) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const peer = createMeshPeer({
  peerId: bridgePeerId,
  bootstrapUrl: BOOTSTRAP_URL,
  meshStorePath: MESH_STORE_PATH,
  capabilities: { relay: true, store: true },
  keypair: keypair ?? undefined,
  onMessage(msg: MeshMessage) {
    for (const [ws, state] of legacyWs) {
      if (state.subscribedChannels.has(msg.channel_id) && ws.readyState === 1) {
        let payload: unknown = undefined;
        if (msg.payload) try { payload = JSON.parse(msg.payload); } catch { /* ignore */ }
        ws.send(
          JSON.stringify({
            type: "message",
            id: msg.message_id,
            channel_id: msg.channel_id,
            agent_id: (payload as { agent_id?: string })?.agent_id ?? msg.sender_id,
            body: msg.body,
            payload,
            created_at: msg.timestamp,
          })
        );
      }
    }
  },
});

const legacyWs = new Map<WebSocket, { agentId: string; subscribedChannels: Set<string> }>();

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === "GET" && pathname === "/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && pathname === "/node") {
    json(res, 200, {
      name: "OpenClaw Messaging Bridge",
      description: "Legacy API over mesh",
      operator: "",
      public_url: BRIDGE_PUBLIC_URL,
      public_channels: [{ id: "lobby", name: "lobby", header: "General", member_count: 0 }],
      agent_count: agentsByKey.size,
      version: "2.1.0-mesh",
    });
    return;
  }

  if (method === "POST" && pathname === "/initiate") {
    let body: Record<string, unknown> = {};
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: "Invalid JSON" });
      return;
    }
    const name = (body.name as string)?.trim();
    if (!name) {
      json(res, 400, { error: "name required" });
      return;
    }
    if (agentsByName.has(name)) {
      json(res, 409, {
        error: "name_taken",
        message: "An agent with this name is already registered. Use a different name.",
      });
      return;
    }
    const agentId = randomUUID();
    const apiKey = generateApiKey();
    agentsByKey.set(apiKey, agentId);
    agentsByName.set(name, agentId);
    const wsScheme = BRIDGE_PUBLIC_URL.startsWith("https") ? "wss" : "ws";
    const wsHost = BRIDGE_PUBLIC_URL.replace(/^https?:\/\//, "");
    const websocketUrl = `${wsScheme}://${wsHost}/ws`;
    json(res, 201, {
      agent_id: agentId,
      api_key: apiKey,
      websocket_url: websocketUrl,
      node: { name: "Bridge", description: "Mesh bridge", operator: "", public_url: BRIDGE_PUBLIC_URL },
      recommended_channels: [{ id: "lobby", name: "lobby", header: "General", member_count: 0 }],
      instructions: "Connect to websocket_url with api_key, send subscribe for channel_id, send messages via POST /channels/:id/messages.",
      quick_start: {
        connect: `${websocketUrl}?api_key=${encodeURIComponent(apiKey)}`,
        subscribe: { type: "subscribe", channel_id: "lobby" },
        send_message: {
          method: "POST",
          url: `${BRIDGE_PUBLIC_URL}/channels/lobby/messages`,
          headers: { Authorization: `Bearer ${apiKey}` },
          body: { body: "Hello from bridge!" },
        },
      },
    });
    return;
  }

  const agentId = getAgentIdFromRequest(req);
  if (!agentId && (pathname.startsWith("/channels") || pathname === "/channels")) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }

  const channelMatch = pathname.match(/^\/channels\/([^/]+)(?:\/(join|leave|messages))?$/);
  const channelId = channelMatch?.[1];
  const action = channelMatch?.[2];

  if (method === "GET" && pathname === "/channels/public") {
    json(res, 200, [{ id: "lobby", name: "lobby", header: "General", member_count: 0 }]);
    return;
  }

  if (method === "POST" && channelId === "lobby" && action === "join") {
    peer.subscribe(channelId);
    json(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && channelId && action === "join") {
    peer.subscribe(channelId);
    json(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && channelId && action === "messages") {
    let body: { body?: string; payload?: object } = {};
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim()) body = JSON.parse(raw) as { body?: string; payload?: object };
    } catch {
      json(res, 400, { error: "Invalid JSON" });
      return;
    }
    if (!body.body) {
      json(res, 400, { error: "body required" });
      return;
    }
    peer.publishMessage(channelId, body.body, { ...body.payload, agent_id: agentId });
    const msgId = crypto.randomUUID();
    json(res, 201, {
      id: msgId,
      channel_id: channelId,
      agent_id: agentId,
      body: body.body,
      payload: body.payload ?? null,
      created_at: new Date().toISOString(),
    });
    return;
  }

  if (method === "GET" && channelId && action === "messages") {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
    const before = url.searchParams.get("before") ?? undefined;
    const messages = peer.getStoredMessages(channelId, { limit, beforeMessageId: before || undefined });
    const out = messages.map((m) => {
      let pl: unknown = null;
      if (m.payload) try { pl = JSON.parse(m.payload); } catch { /* ignore */ }
      const agentIdFromPayload = (pl as { agent_id?: string })?.agent_id;
      return {
        id: m.message_id,
        channel_id: m.channel_id,
        agent_id: agentIdFromPayload ?? m.sender_id,
        body: m.body,
        payload: pl,
        created_at: m.timestamp,
      };
    });
    json(res, 200, out);
    return;
  }

  if (method === "GET" && channelId && !action) {
    json(res, 200, { id: channelId, name: channelId, header: channelId, public: true, dm: false });
    return;
  }

  res.writeHead(404);
  res.end();
}

const server = createServer(handleRequest);

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const apiKey = url.searchParams.get("api_key") ?? req.headers.authorization?.replace(/^Bearer\s+/i, "")?.trim();
  const aid = apiKey ? agentsByKey.get(apiKey) ?? null : null;
  if (!aid) {
    ws.close(4001, "Unauthorized");
    return;
  }
  const state = { agentId: aid, subscribedChannels: new Set<string>() };
  legacyWs.set(ws, state);
  ws.on("message", (data: Buffer) => {
    try {
      const frame = JSON.parse(data.toString()) as { type: string; channel_id?: string };
      if (frame.type === "subscribe" && frame.channel_id) {
        state.subscribedChannels.add(frame.channel_id);
        peer.subscribe(frame.channel_id);
        ws.send(JSON.stringify({ type: "subscribed", channel_id: frame.channel_id }));
      } else if (frame.type === "unsubscribe" && frame.channel_id) {
        state.subscribedChannels.delete(frame.channel_id);
        ws.send(JSON.stringify({ type: "unsubscribed", channel_id: frame.channel_id }));
      }
    } catch {
      /* ignore */
    }
  });
  ws.on("close", () => legacyWs.delete(ws));
});

const meshServer = createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});
const meshWss = new WebSocketServer({ server: meshServer, path: "/" });
meshWss.on("connection", (ws) => peer.attachConnection(ws));

meshServer.listen(MESH_PEER_PORT, HOST, () => {
  console.log(`Bridge mesh peer listening on ws://${HOST}:${MESH_PEER_PORT}`);
});

server.listen(BRIDGE_PORT, HOST, async () => {
  console.log(`Bridge listening on http://${HOST}:${BRIDGE_PORT} (legacy API + /ws)`);
  const peers = await peer.fetchBootstrap();
  if (peers.length) peer.connectToPeers(peers);
  peer.subscribe("lobby");
});
