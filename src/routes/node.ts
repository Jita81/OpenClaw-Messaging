import { IncomingMessage, ServerResponse } from "http";
import { loadNodeConfig } from "../config.js";
import { listPublicChannels, getAgentCount } from "../db.js";

function getBaseUrl(req: IncomingMessage): string {
  const config = loadNodeConfig();
  if (config.publicUrl) return config.publicUrl;
  const host = req.headers.host ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return `${proto}://${host}`;
}

export async function getNode(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = loadNodeConfig();
  const baseUrl = getBaseUrl(req);
  const publicUrl = config.publicUrl || baseUrl;
  const publicChannels = listPublicChannels();
  const agentCount = getAgentCount();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      name: config.name,
      description: config.description,
      operator: config.operator,
      public_url: publicUrl,
      public_channels: publicChannels.map((c) => ({
        id: c.id,
        name: c.name,
        header: c.header,
        member_count: c.member_count,
      })),
      agent_count: agentCount,
      version: config.version,
    })
  );
}
