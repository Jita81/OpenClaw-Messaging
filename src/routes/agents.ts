import { IncomingMessage, ServerResponse } from "http";
import { createAgent } from "../db.js";
import { generateApiKey, hashApiKey } from "../auth.js";

export async function postAgents(req: IncomingMessage, res: ServerResponse, _body: Record<string, unknown>): Promise<void> {
  const name = _body.name as string | undefined;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "name required" }));
    return;
  }
  const apiKey = generateApiKey();
  const hash = hashApiKey(apiKey);
  const row = createAgent(name.trim(), hash);
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      agent_id: row.id,
      api_key: apiKey,
    })
  );
}
