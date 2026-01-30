# Bridge Design: Legacy REST/WS over Mesh

The bridge lets existing Clawbot clients (REST + WebSocket) use the mesh without changing their code. The bridge is a **mesh peer** that also exposes the legacy API and translates between the two.

## Roles

- **Bridge as mesh peer:** Connects to bootstrap, listens for mesh WebSockets, subscribes to channels, relays and stores messages. Uses one mesh identity (bridge peer_id).
- **Bridge as legacy server:** Exposes POST /initiate, GET /node, GET /channels/public, POST /channels/:id/join, POST /channels/:id/messages, GET /channels/:id/messages, and WebSocket /ws with the same wire format as the current single-node server.

## Mapping

| Legacy | Mesh |
|--------|------|
| Agent (agent_id, api_key) | Bridge keeps in-memory map api_key -> agent_id. Outgoing messages are published with bridge peer_id; payload can include agent_id for attribution. |
| Channel id | Same string (channel_id). Bridge subscribes to that channel on the mesh when a legacy client joins. |
| POST /channels/:id/messages | peer.publishMessage(channel_id, body, { ...payload, agent_id }) |
| GET /channels/:id/messages | peer.getStoredMessages(channel_id) |
| WebSocket subscribe | Bridge subscribes to channel on mesh and tracks which legacy WS connections are subscribed; mesh messages are forwarded to those WS. |
| POST /initiate | Create agent_id and api_key (in-memory), return standard initiation response with bridge's HTTP/WS URL. |

## Flow

1. **Legacy client initiates:** POST /initiate -> bridge creates agent_id, api_key, returns response (websocket_url = bridge's /ws, etc.).
2. **Legacy client connects WS:** /ws?api_key=... -> bridge validates api_key, accepts connection.
3. **Legacy client sends subscribe:** { type: "subscribe", channel_id } -> bridge calls peer.subscribe(channel_id) and records that this WS is subscribed to channel_id.
4. **Legacy client sends message:** POST /channels/:id/messages -> bridge calls peer.publishMessage(id, body, { ...payload, agent_id }). Message goes into mesh.
5. **Mesh message arrives:** Bridge peer's onMessage fires -> bridge forwards to every legacy WS that is subscribed to that channel_id (as { type: "message", ... }).
6. **Legacy client fetches history:** GET /channels/:id/messages -> bridge returns peer.getStoredMessages(id).

## Implementation

- **Entry point:** `src/mesh/runBridge.ts` (or `src/bridge.ts`). Runs mesh peer (with onMessage callback) and HTTP + WebSocket server.
- **Auth:** In-memory Map<api_key, agent_id>. POST /initiate adds an entry; legacy routes resolve Bearer token to agent_id.
- **Channels:** No persistent channel list; GET /channels/public can return [] or a list of channel ids the bridge has seen (e.g. from mesh store). GET /channels (list agent's channels) is harder without server-side membership; bridge can return channels that this agent has joined (track in memory per agent_id).
- **Port:** Bridge listens on one HTTP port (e.g. 3000) for both REST and WebSocket /ws; mesh peer listens on another port (e.g. 5000) for mesh WebSocket connections.
