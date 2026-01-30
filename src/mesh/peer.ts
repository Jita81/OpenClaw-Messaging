/**
 * Mesh peer: connect to other peers via WebSocket, handshake, subscribe to channels,
 * broadcast and relay messages, store locally with dedup. Optional Ed25519 signing.
 */
import WebSocket from "ws";
import {
  initMeshStore,
  insertMeshMessage,
  hasMeshMessage,
  getMeshMessages,
  type MeshMessage,
} from "./meshStore.js";
import {
  messageCanonical,
  signMessage,
  verifyMessage,
  type KeyPair,
} from "./identity.js";

const PROTOCOL_VERSION = 1;

export type PeerConfig = {
  peerId: string;
  bootstrapUrl: string;
  meshStorePath: string;
  capabilities: { relay: boolean; store: boolean };
  /** If set, handshake includes public_key and outgoing messages are signed. */
  keypair?: KeyPair | null;
  /** Called when a new message is stored (from mesh). Used by bridge to forward to legacy WS. */
  onMessage?: (msg: MeshMessage) => void;
};

type PeerConnection = {
  ws: WebSocket;
  remotePeerId: string | null;
  remotePublicKeyPem: string | null;
  subscribedChannels: Set<string>;
  sentMessageIds: Set<string>;
  handshakeDone: boolean;
};

const peerIdToPublicKeyPem = new Map<string, string>();

export type BootstrapPeer = {
  peer_id: string;
  ws_url: string;
  capabilities?: { relay?: boolean; store?: boolean };
};

export type BootstrapResponse = {
  version: number;
  peers: BootstrapPeer[];
  updated_at?: string;
};

export function createMeshPeer(config: PeerConfig) {
  initMeshStore(config.meshStorePath);
  const connections = new Map<WebSocket, PeerConnection>();

  function getOrCreateConn(ws: WebSocket): PeerConnection {
    let c = connections.get(ws);
    if (!c) {
      c = {
        ws,
        remotePeerId: null,
        remotePublicKeyPem: null,
        subscribedChannels: new Set(),
        sentMessageIds: new Set(),
        handshakeDone: false,
      };
      connections.set(ws, c);
    }
    return c;
  }

  function send(ws: WebSocket, obj: object) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function broadcastMessage(msg: MeshMessage, excludeWs?: WebSocket, signature?: string) {
    let payloadObj: unknown = undefined;
    if (msg.payload) {
      try {
        payloadObj = JSON.parse(msg.payload) as object;
      } catch {
        payloadObj = undefined;
      }
    }
    const payload: Record<string, unknown> = {
      type: "message",
      message_id: msg.message_id,
      channel_id: msg.channel_id,
      sender_id: msg.sender_id,
      body: msg.body,
      payload: payloadObj,
      timestamp: msg.timestamp,
    };
    if (signature) payload.signature = signature;
    for (const [sock, conn] of connections) {
      if (sock === excludeWs) continue;
      if (!conn.handshakeDone) continue;
      if (!conn.subscribedChannels.has(msg.channel_id)) continue;
      if (conn.sentMessageIds.has(msg.message_id)) continue;
      send(sock, payload);
      conn.sentMessageIds.add(msg.message_id);
    }
  }

  function handleFrame(ws: WebSocket, data: Buffer) {
    const conn = getOrCreateConn(ws);
    let frame: { type: string; [k: string]: unknown };
    try {
      frame = JSON.parse(data.toString()) as { type: string; [k: string]: unknown };
    } catch {
      send(ws, { type: "error", code: "invalid_message", message: "Invalid JSON" });
      return;
    }

    switch (frame.type) {
      case "handshake": {
        const version = Number(frame.version);
        if (version !== PROTOCOL_VERSION) {
          send(ws, { type: "error", code: "unsupported_version", message: "Unsupported protocol version" });
          ws.close();
          return;
        }
        conn.remotePeerId = (frame.peer_id as string) ?? null;
        const remotePub = frame.public_key as string | undefined;
        if (remotePub && conn.remotePeerId) peerIdToPublicKeyPem.set(conn.remotePeerId, remotePub);
        conn.remotePublicKeyPem = remotePub ?? null;
        conn.handshakeDone = true;
        const handshakeReply: Record<string, unknown> = {
          type: "handshake",
          version: PROTOCOL_VERSION,
          peer_id: config.peerId,
          capabilities: config.capabilities,
        };
        if (config.keypair?.publicKey) handshakeReply.public_key = config.keypair.publicKey;
        send(ws, handshakeReply);
        break;
      }
      case "subscribe": {
        const channelId = frame.channel_id as string;
        if (channelId) conn.subscribedChannels.add(channelId);
        break;
      }
      case "unsubscribe": {
        const channelId = frame.channel_id as string;
        if (channelId) conn.subscribedChannels.delete(channelId);
        break;
      }
      case "message": {
        const messageId = frame.message_id as string;
        const channelId = frame.channel_id as string;
        const senderId = frame.sender_id as string;
        const body = frame.body as string;
        const timestamp = (frame.timestamp as string) ?? new Date().toISOString();
        const signature = frame.signature as string | undefined;
        if (!messageId || !channelId || !senderId || body === undefined) {
          send(ws, { type: "error", code: "invalid_message", message: "Missing fields" });
          return;
        }
        const meshMsg: MeshMessage = {
          message_id: messageId,
          channel_id: channelId,
          sender_id: senderId,
          body,
          payload: frame.payload != null ? JSON.stringify(frame.payload) : null,
          timestamp,
        };
        if (signature) {
          const canonical = messageCanonical(meshMsg);
          const senderPub = peerIdToPublicKeyPem.get(senderId);
          if (senderPub && !verifyMessage(canonical, signature, senderPub)) {
            send(ws, { type: "error", code: "invalid_message", message: "Invalid signature" });
            return;
          }
        }
        if (hasMeshMessage(messageId)) {
          conn.sentMessageIds.add(messageId);
          return;
        }
        if (config.capabilities.store) insertMeshMessage(meshMsg);
        conn.sentMessageIds.add(messageId);
        if (config.capabilities.relay) broadcastMessage(meshMsg, ws, signature);
        config.onMessage?.(meshMsg);
        break;
      }
      default:
        break;
    }
  }

  function attachConnection(ws: WebSocket) {
    getOrCreateConn(ws);
    ws.on("message", (data: Buffer) => handleFrame(ws, data));
    ws.on("close", () => connections.delete(ws));
    ws.on("error", () => connections.delete(ws));
  }

  async function fetchBootstrap(): Promise<BootstrapPeer[]> {
    const res = await fetch(config.bootstrapUrl);
    if (!res.ok) return [];
    const json = (await res.json()) as BootstrapResponse;
    return json.peers ?? [];
  }

  function connectToPeers(peers: BootstrapPeer[]) {
    for (const p of peers) {
      if (!p.ws_url || p.peer_id === config.peerId) continue;
      try {
        const ws = new WebSocket(p.ws_url);
        ws.on("open", () => {
          const handshake: Record<string, unknown> = {
            type: "handshake",
            version: PROTOCOL_VERSION,
            peer_id: config.peerId,
            capabilities: config.capabilities,
          };
          if (config.keypair?.publicKey) handshake.public_key = config.keypair.publicKey;
          send(ws, handshake);
        });
        ws.on("message", (data: Buffer) => handleFrame(ws, data));
        ws.on("close", () => connections.delete(ws));
        ws.on("error", () => connections.delete(ws));
        getOrCreateConn(ws);
      } catch {
        // skip failed connect
      }
    }
  }

  function subscribe(channelId: string) {
    for (const [ws, conn] of connections) {
      if (conn.handshakeDone) {
        conn.subscribedChannels.add(channelId);
        send(ws, { type: "subscribe", channel_id: channelId });
      }
    }
  }

  function publishMessage(channelId: string, body: string, payload?: object): string {
    const messageId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const meshMsg: MeshMessage = {
      message_id: messageId,
      channel_id: channelId,
      sender_id: config.peerId,
      body,
      payload: payload != null ? JSON.stringify(payload) : null,
      timestamp,
    };
    let signature: string | undefined;
    if (config.keypair?.privateKey) {
      const canonical = messageCanonical(meshMsg);
      signature = signMessage(canonical, config.keypair.privateKey);
    }
    if (config.capabilities.store) insertMeshMessage(meshMsg);
    broadcastMessage(meshMsg, undefined, signature);
    return messageId;
  }

  function getStoredMessages(
    channelId: string,
    opts?: { afterMessageId?: string; beforeMessageId?: string; limit?: number }
  ): MeshMessage[] {
    return getMeshMessages(channelId, opts ?? {});
  }

  return {
    attachConnection,
    fetchBootstrap,
    connectToPeers,
    subscribe,
    publishMessage,
    getStoredMessages,
    get connectionCount(): number {
      return connections.size;
    },
  };
}
