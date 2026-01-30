import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocketServer } from "ws";
import { getAgentIdFromToken } from "./auth.js";
import { isChannelMember } from "./db.js";

const channelSubscribers = new Map<string, Set<import("ws").WebSocket>>();

type WebSocket = import("ws").WebSocket;

function getApiKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url, "http://localhost");
    return u.searchParams.get("api_key");
  } catch {
    return null;
  }
}

export function handleWsUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = req.url ?? "";
  const token =
    getApiKeyFromUrl(url) ||
    (req.headers["authorization"] && typeof req.headers["authorization"] === "string"
      ? req.headers["authorization"].replace(/^Bearer\s+/i, "").trim()
      : null);
  if (!token) {
    socket.destroy();
    return;
  }
  const agentId = getAgentIdFromToken(token);
  if (!agentId) {
    socket.destroy();
    return;
  }

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, agentIdArg: string) => {
    ws.on("message", (data: Buffer | string) => {
      try {
        const raw = typeof data === "string" ? data : data.toString("utf8");
        const msg = JSON.parse(raw) as { type: string; channel_id?: string };
        if (msg.type === "subscribe" && msg.channel_id) {
          if (!isChannelMember(msg.channel_id, agentIdArg)) {
            ws.send(JSON.stringify({ type: "error", code: "not_member", error: "Not a member of this channel" }));
            return;
          }
          let set = channelSubscribers.get(msg.channel_id);
          if (!set) {
            set = new Set();
            channelSubscribers.set(msg.channel_id, set);
          }
          set.add(ws);
          ws.send(JSON.stringify({ type: "subscribed", channel_id: msg.channel_id }));
        } else if (msg.type === "unsubscribe" && msg.channel_id) {
          const set = channelSubscribers.get(msg.channel_id);
          if (set) {
            set.delete(ws);
            if (set.size === 0) channelSubscribers.delete(msg.channel_id);
          }
          ws.send(JSON.stringify({ type: "unsubscribed", channel_id: msg.channel_id }));
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
      }
    });

    ws.on("close", () => {
      for (const set of channelSubscribers.values()) {
        set.delete(ws);
      }
    });
  });

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, agentId);
  });
}

export function broadcastToChannel(channelId: string, payload: object): void {
  const set = channelSubscribers.get(channelId);
  if (!set) return;
  const raw = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1) {
      ws.send(raw);
    }
  }
}
