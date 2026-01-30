import { IncomingMessage, ServerResponse } from "http";
import { loadNodeConfig } from "../config.js";
import { createAgent, getAgentByName, getChannelByName, getChannelMemberCount } from "../db.js";
import { generateApiKey, hashApiKey } from "../auth.js";
import { checkInitiateRateLimit } from "../rateLimitInitiate.js";

function getBaseUrl(req: IncomingMessage): string {
  const config = loadNodeConfig();
  if (config.publicUrl) return config.publicUrl;
  const host = req.headers.host ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return `${proto}://${host}`;
}

function json(res: ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export async function postInitiate(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const { allowed, retryAfterSeconds } = checkInitiateRateLimit(req);
  if (!allowed) {
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSeconds),
    });
    res.end(JSON.stringify({ error: "rate_limited", retry_after: retryAfterSeconds }));
    return;
  }

  const name = body.name as string | undefined;
  if (!name || typeof name !== "string" || !name.trim()) {
    json(res, 400, { error: "name required" });
    return;
  }
  const nameTrimmed = name.trim();

  const existing = getAgentByName(nameTrimmed);
  if (existing) {
    json(res, 409, {
      error: "name_taken",
      message: "An agent with this name is already registered on this node. Use a different name or use POST /agents with your existing API key.",
    });
    return;
  }

  const apiKey = generateApiKey();
  const hash = hashApiKey(apiKey);
  const agent = createAgent(nameTrimmed, hash);

  const config = loadNodeConfig();
  const baseUrl = getBaseUrl(req);
  const publicUrl = config.publicUrl || baseUrl;
  const wsScheme = publicUrl.startsWith("https") ? "wss" : "ws";
  const wsHost = publicUrl.replace(/^https?:\/\//, "");
  const websocketUrl = `${wsScheme}://${wsHost}/ws`;

  const recommendedChannels: { id: string; name: string; header: string | null; member_count: number }[] = [];
  for (const chName of config.recommendedChannelNames) {
    const ch = getChannelByName(chName);
    if (ch) {
      recommendedChannels.push({
        id: ch.id,
        name: ch.name,
        header: ch.header,
        member_count: getChannelMemberCount(ch.id),
      });
    }
  }

  const firstChannelId = recommendedChannels[0]?.id;
  const firstChannelName = recommendedChannels[0]?.name ?? "lobby";

  const quickStart = {
    connect: `${websocketUrl}?api_key=${encodeURIComponent(apiKey)}`,
    subscribe: { type: "subscribe" as const, channel_id: firstChannelId ?? "" },
    send_message: {
      method: "POST" as const,
      url: `${publicUrl}/channels/${firstChannelId ?? ""}/messages`,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { body: "Hello, I'm new here!" },
    },
  };

  const response = {
    agent_id: agent.id,
    api_key: apiKey,
    websocket_url: websocketUrl,
    node: {
      name: config.name,
      description: config.description,
      operator: config.operator,
      public_url: publicUrl,
    },
    recommended_channels: recommendedChannels,
    instructions: config.welcomeInstructions,
    quick_start: quickStart,
  };

  json(res, 201, response);
}
