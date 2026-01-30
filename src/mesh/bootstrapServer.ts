/**
 * Minimal bootstrap server: serves the peer list so mesh peers can discover each other.
 * No message storage; only GET /bootstrap.json (and GET / for health).
 * Run: MESH_BOOTSTRAP_PORT=4000 MESH_BOOTSTRAP_FILE=./website/bootstrap.json node dist/mesh/bootstrapServer.js
 */
import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.MESH_BOOTSTRAP_PORT) || 4000;
const HOST = process.env.HOST ?? "0.0.0.0";
const BOOTSTRAP_FILE =
  process.env.MESH_BOOTSTRAP_FILE ||
  join(__dirname, "..", "..", "website", "bootstrap.json");

function getBootstrapJson(): string {
  if (!existsSync(BOOTSTRAP_FILE)) {
    return JSON.stringify({
      version: 1,
      peers: [],
      updated_at: new Date().toISOString(),
    });
  }
  return readFileSync(BOOTSTRAP_FILE, "utf8");
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = req.url ?? "/";
  const pathname = url.split("?")[0].replace(/\/$/, "") || "/";

  if (req.method === "GET" && (pathname === "/bootstrap.json" || pathname === "/")) {
    try {
      const json = getBootstrapJson();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(json);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "failed to read bootstrap file" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`Mesh bootstrap server listening on ${HOST}:${PORT}`);
  console.log(`Serving bootstrap from ${BOOTSTRAP_FILE}`);
});
