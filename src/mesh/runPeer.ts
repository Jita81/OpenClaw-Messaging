/**
 * Mesh peer entry point: listen for incoming WebSocket connections, fetch bootstrap, connect to peers.
 * Run: MESH_PEER_PORT=5000 MESH_BOOTSTRAP_URL=http://localhost:4000/bootstrap.json node dist/mesh/runPeer.js
 * Optional: MESH_KEY_DIR=./data/mesh-keys for Ed25519 keypair (peer_id and signing).
 */
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { createMeshPeer } from "./peer.js";
import { loadOrCreateKeypair, publicKeyToPeerId } from "./identity.js";

const PORT = Number(process.env.MESH_PEER_PORT) || 5000;
const HOST = process.env.HOST ?? "0.0.0.0";
const BOOTSTRAP_URL = process.env.MESH_BOOTSTRAP_URL ?? "http://localhost:4000/bootstrap.json";
const MESH_STORE_PATH = process.env.MESH_STORE_PATH ?? "./data/mesh.db";
const MESH_KEY_DIR = process.env.MESH_KEY_DIR ?? "";

let peerId: string;
let keypair: { publicKey: string; privateKey: string } | null = null;
if (MESH_KEY_DIR) {
  keypair = loadOrCreateKeypair(MESH_KEY_DIR);
  peerId = publicKeyToPeerId(keypair.publicKey);
} else {
  peerId = process.env.MESH_PEER_ID ?? `peer-${Math.random().toString(36).slice(2, 10)}`;
}

const peer = createMeshPeer({
  peerId,
  bootstrapUrl: BOOTSTRAP_URL,
  meshStorePath: MESH_STORE_PATH,
  capabilities: { relay: true, store: true },
  keypair: keypair ?? undefined,
});

const server = createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  peer.attachConnection(ws);
});

server.listen(PORT, HOST, async () => {
  console.log(`Mesh peer ${peerId} listening on ws://${HOST}:${PORT}`);
  try {
    const peers = await peer.fetchBootstrap();
    if (peers.length) {
      peer.connectToPeers(peers);
      console.log(`Fetched ${peers.length} peer(s) from bootstrap`);
    } else {
      console.log("Bootstrap returned no peers (run bootstrap server and add this peer to bootstrap.json)");
    }
  } catch (e) {
    console.warn("Bootstrap fetch failed:", (e as Error).message);
  }
});
