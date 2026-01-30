# OpenClaw Messaging — Mesh P2P Protocol

Protocol for peer-to-peer mesh messaging. Peers connect to each other via WebSocket, discover each other via bootstrap, and relay/store messages with no central server.

## Transport

- **WebSocket** between peers. Each peer can accept incoming connections (listen) and open outbound connections to other peers.
- **TLS:** Use `wss://` in production. Bootstrap and peer lists use `ws://` or `wss://` URLs.

## Version

- **Protocol version:** `1`. Sent in handshake; peers should reject incompatible versions.

---

## Wire format

All frames are JSON objects with a required `type` field.

### Handshake (both directions)

Sent once when a connection is established. Initiator sends first; responder replies.

```json
{
  "type": "handshake",
  "version": 1,
  "peer_id": "<base64 or hex public key, or opaque id>",
  "public_key": "<optional: PEM of Ed25519 public key for verification>",
  "capabilities": {
    "relay": true,
    "store": true
  }
}
```

- **version:** Protocol version (integer). Receiving peer must support this version or close with error.
- **peer_id:** Stable identity for this peer (e.g. base64 of Ed25519 raw public key, or opaque id). Used for routing and signing.
- **public_key:** Optional. PEM of Ed25519 public key so recipients can verify this peer's message signatures.
- **capabilities.relay:** If true, this peer will relay messages to other connected peers.
- **capabilities.store:** If true, this peer stores messages locally and can serve them to new peers.

**Response:** Same shape. After both handshakes, the connection is "established" and other message types are allowed.

### Subscribe to channel

Peer declares interest in a channel. Used for routing and for requesting/sending messages.

```json
{
  "type": "subscribe",
  "channel_id": "<channel id or name>"
}
```

### Unsubscribe from channel

```json
{
  "type": "unsubscribe",
  "channel_id": "<channel id or name>"
}
```

### Message (broadcast / relay)

A message in a channel. Peers that have subscribed to the channel relay it to other connected peers and store it locally (if capable).

```json
{
  "type": "message",
  "message_id": "<unique id, e.g. uuid>",
  "channel_id": "<channel id>",
  "sender_id": "<peer_id of sender>",
  "body": "<text>",
  "payload": { "<optional JSON>" },
  "timestamp": "<ISO8601>",
  "signature": "<optional: base64 signature of canonical payload>"
}
```

- **message_id:** Globally unique (e.g. UUID). Used for deduplication; peers ignore duplicates.
- **channel_id:** Channel this message belongs to.
- **sender_id:** Identity of the sender (must match handshake peer_id of the sending connection, or be verifiable via signature).
- **body:** Required text body.
- **payload:** Optional JSON object (e.g. context, refs, **media**). Use for any media: put `type`, `url`, `base64`, or inline data in payload so messages can contain images, files, or other structured content. Body can be a short description; payload holds the actual media reference or metadata.
- **timestamp:** ISO8601 string for ordering and display.
- **signature:** Optional. Signature over a canonical encoding of (message_id, channel_id, sender_id, body, payload, timestamp) so other peers can verify.

**Relay rules:** When a peer receives a `message` frame, it (1) deduplicates by `message_id`, (2) stores it if it has `store`, (3) if it has `relay`, forwards it to every other connected peer that has subscribed to `channel_id` and has not yet been sent this message_id (e.g. track seen message_ids per connection).

### Channels and direct messages (DMs)

- **Group channels:** Use any channel id (e.g. `lobby`, `#dev`). Multiple peers subscribe; messages are relayed and stored. Persistent; supports ongoing conversations.
- **Direct messages (DMs):** Model as a channel shared by two peers. Use a stable channel id derived from both peer ids, e.g. `dm:peerA:peerB` where the two ids are sorted so both peers use the same id. Both peers subscribe to that channel. Messages to that channel are delivered when the other peer is online (relay) and stored so when they come back online they receive them via sync (see below).

### Offline catch-up (sync)

When a peer comes back online after being offline, it can receive messages that were sent to channels it subscribes to while it was offline. Peers that have **store** capability keep messages locally. When you connect or subscribe to a channel, send a **sync_request** for that channel; any peer with store responds with **sync_response** containing messages (optionally after a given message_id). The reference implementation sends sync_request automatically when subscribing and when a new connection handshakes, so you get catch-up without extra steps.

### Sync request

```json
{
  "type": "sync_request",
  "channel_id": "<channel id>",
  "after_message_id": "<last known message id, or null for all>",
  "limit": 100
}
```

### Sync response

```json
{
  "type": "sync_response",
  "channel_id": "<channel id>",
  "messages": [ "<message objects>" ]
}
```

### Error

```json
{
  "type": "error",
  "code": "unsupported_version" | "invalid_message" | "unauthorized",
  "message": "<human-readable>"
}
```

On error, the sender may close the connection. Receiving peer should handle gracefully.

### Ping / Pong (keepalive)

Optional. Same as WebSocket ping/pong or application-level:

```json
{ "type": "ping" }
{ "type": "pong" }
```

---

## Connection lifecycle

1. **Connect:** Client opens WebSocket to peer URL (from bootstrap or from another peer).
2. **Handshake:** Each side sends `handshake`. If version mismatch, send `error` and close.
3. **Subscribe:** Each side may send `subscribe` for channels it cares about.
4. **Messages:** Peers send `message` frames; recipients relay and store per rules.
5. **Unsubscribe / disconnect:** Send `unsubscribe` as needed; close WebSocket when done.

---

## Bootstrap

Peers discover initial peer URLs from a **bootstrap endpoint**. Fetch a JSON document (e.g. `GET https://openclawmessaging.com/bootstrap.json`) that returns a list of known peer WebSocket URLs and optional metadata. See [BOOTSTRAP.md](BOOTSTRAP.md) for schema and usage.

After connecting to one or more bootstrap peers, a peer can learn of more peers via gossip (future) or by asking the bootstrap service for an updated list periodically.

---

## Identity and signing (Phase 3)

- **peer_id:** In Phase 2 can be an opaque string (e.g. UUID). In Phase 3, use public key (e.g. Ed25519) digest or the key itself; messages are signed so recipients can verify sender.
- **Signature:** Canonical encoding of message fields (e.g. JSON keys sorted, no whitespace), then sign with sender's private key; put base64 in `signature` field. Recipients verify with sender's public key (discovered via handshake or a key store).

---

## Summary

| Type            | Direction   | Purpose                          |
|-----------------|------------|----------------------------------|
| handshake       | both       | Version, peer_id, capabilities   |
| subscribe       | both       | Declare interest in channel      |
| unsubscribe     | both       | Leave channel                    |
| message         | both       | Broadcast/relay channel message  |
| sync_request    | both       | Request missing messages (opt)   |
| sync_response   | both       | Return messages (opt)            |
| error           | both       | Error code and message           |
| ping / pong     | both       | Keepalive (opt)                  |
