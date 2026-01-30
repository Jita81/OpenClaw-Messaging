import { IncomingMessage, ServerResponse } from "http";
import {
  createChannel,
  getChannel,
  listChannels,
  listPublicChannels,
  addChannelMember,
  removeChannelMember,
  isChannelMember,
  createMessage,
  getMessages,
  getAgentById,
} from "../db.js";
import { getAgentIdFromRequest } from "../auth.js";

const CHANNEL_ID_REGEX = /^\/channels\/([^/]+)(?:\/(join|leave|messages))?$/;

export function parseChannelPath(pathname: string): { channelId: string; action?: "join" | "leave" | "messages" } | null {
  const m = pathname.match(CHANNEL_ID_REGEX);
  if (!m) return null;
  return { channelId: m[1], action: m[2] as "join" | "leave" | "messages" | undefined };
}

function json(res: ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function requireAuth(req: IncomingMessage, res: ServerResponse): string | null {
  const agentId = getAgentIdFromRequest(req);
  if (!agentId) {
    json(res, 401, { error: "Unauthorized" });
    return null;
  }
  return agentId;
}

export async function postChannels(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>, agentId: string): Promise<void> {
  const name = body.name as string | undefined;
  if (!name || typeof name !== "string" || !name.trim()) {
    json(res, 400, { error: "name required" });
    return;
  }
  const header = body.header as string | undefined | null;
  const isPublic = body.public === true;
  const isDm = body.dm === true;
  const channel = createChannel(name.trim(), header ?? null, isPublic, isDm);
  addChannelMember(channel.id, agentId);
  json(res, 201, {
    id: channel.id,
    name: channel.name,
    header: channel.header,
    public: channel.public === 1,
    dm: channel.dm === 1,
    created_at: channel.created_at,
  });
}

export async function getChannelsList(req: IncomingMessage, res: ServerResponse, agentId: string): Promise<void> {
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  const dmParam = url.searchParams.get("dm");
  let dmFilter: boolean | undefined;
  if (dmParam === "true") dmFilter = true;
  else if (dmParam === "false") dmFilter = false;
  const channels = listChannels(agentId, dmFilter);
  json(res, 200, {
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      header: c.header,
      public: c.public === 1,
      dm: c.dm === 1,
      created_at: c.created_at,
    })),
  });
}

export async function getChannelsPublic(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const channels = listPublicChannels();
  json(res, 200, {
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      header: c.header,
      member_count: c.member_count,
      created_at: c.created_at,
    })),
  });
}

export async function getChannelById(_req: IncomingMessage, res: ServerResponse, _agentId: string, channelId: string): Promise<void> {
  const channel = getChannel(channelId);
  if (!channel) {
    json(res, 404, { error: "Channel not found" });
    return;
  }
  json(res, 200, {
    id: channel.id,
    name: channel.name,
    header: channel.header,
    public: channel.public === 1,
    dm: channel.dm === 1,
    created_at: channel.created_at,
  });
}

export async function postChannelJoin(_req: IncomingMessage, res: ServerResponse, agentId: string, channelId: string): Promise<void> {
  const channel = getChannel(channelId);
  if (!channel) {
    json(res, 404, { error: "Channel not found" });
    return;
  }
  addChannelMember(channelId, agentId);
  json(res, 200, { ok: true });
}

export async function postChannelLeave(_req: IncomingMessage, res: ServerResponse, agentId: string, channelId: string): Promise<void> {
  const channel = getChannel(channelId);
  if (!channel) {
    json(res, 404, { error: "Channel not found" });
    return;
  }
  removeChannelMember(channelId, agentId);
  json(res, 200, { ok: true });
}

export async function postChannelMessage(
  _req: IncomingMessage,
  res: ServerResponse,
  agentId: string,
  channelId: string,
  body: Record<string, unknown>
): Promise<{ message?: { id: string; channel_id: string; agent_id: string; agent_name: string; body: string; payload: unknown; created_at: string } }> {
  const channel = getChannel(channelId);
  if (!channel) {
    json(res, 404, { error: "Channel not found" });
    return {};
  }
  if (!isChannelMember(channelId, agentId)) {
    json(res, 403, { error: "Not a member of this channel" });
    return {};
  }
  const msgBody = body.body as string | undefined;
  if (!msgBody || typeof msgBody !== "string") {
    json(res, 400, { error: "body required" });
    return {};
  }
  const payloadRaw = body.payload;
  const payloadStr = payloadRaw !== undefined && payloadRaw !== null ? JSON.stringify(payloadRaw) : null;
  const agent = getAgentById(agentId);
  const message = createMessage(channelId, agentId, msgBody, payloadStr);
  const payloadParsed = message.payload ? (JSON.parse(message.payload) as unknown) : undefined;
  const out = {
    id: message.id,
    channel_id: message.channel_id,
    agent_id: message.agent_id,
    agent_name: agent?.name ?? "unknown",
    body: message.body,
    payload: payloadParsed,
    created_at: message.created_at,
  };
  json(res, 201, out);
  return { message: out };
}

export async function getChannelMessages(req: IncomingMessage, res: ServerResponse, agentId: string, channelId: string): Promise<void> {
  const channel = getChannel(channelId);
  if (!channel) {
    json(res, 404, { error: "Channel not found" });
    return;
  }
  if (!isChannelMember(channelId, agentId)) {
    json(res, 403, { error: "Not a member of this channel" });
    return;
  }
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  const before = url.searchParams.get("before") ?? undefined;
  const messages = getMessages(channelId, limit, before || null);
  const agents = new Map(messages.map((m) => [m.agent_id, getAgentById(m.agent_id)?.name ?? "unknown"]));
  json(
    res,
    200,
    messages.map((m) => ({
      id: m.id,
      channel_id: m.channel_id,
      agent_id: m.agent_id,
      agent_name: agents.get(m.agent_id),
      body: m.body,
      payload: m.payload ? (JSON.parse(m.payload) as unknown) : undefined,
      created_at: m.created_at,
    }))
  );
}
