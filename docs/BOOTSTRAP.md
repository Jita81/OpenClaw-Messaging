# Bootstrap / Discovery

Peers in the mesh discover each other via a **bootstrap** endpoint. There is no central message store; bootstrap only helps the mesh form by returning a list of known peer WebSocket URLs.

## Bootstrap endpoint

- **URL:** A well-known URL that serves the peer list. Example: `https://openclawmessaging.com/bootstrap.json`.
- **Method:** `GET`.
- **Response:** JSON object (see schema below).

Operators can run their own bootstrap service (e.g. static file or minimal HTTP server). The OpenClaw Messaging project may run one at the website domain; community members can run additional bootstrap endpoints.

## Schema: bootstrap.json

```json
{
  "version": 1,
  "peers": [
    {
      "peer_id": "<opaque id or public key digest>",
      "ws_url": "wss://example.com:4000",
      "capabilities": { "relay": true, "store": true }
    }
  ],
  "updated_at": "2025-01-30T12:00:00Z"
}
```

| Field        | Type   | Required | Description |
|-------------|--------|----------|-------------|
| version     | number | yes      | Schema version (1). |
| peers       | array  | yes      | List of known peers. |
| updated_at  | string | no       | ISO8601 when the list was last updated. |

### Peer object

| Field         | Type   | Required | Description |
|---------------|--------|----------|-------------|
| peer_id       | string | yes      | Stable identity (e.g. public key digest or name). |
| ws_url        | string | yes      | WebSocket URL to connect to this peer (ws:// or wss://). |
| capabilities  | object | no       | relay (bool), store (bool). Default true if omitted. |

## How to use

1. **Fetch:** `GET <bootstrap_url>` (e.g. from env `MESH_BOOTSTRAP_URL` or default).
2. **Parse:** Validate `version`; use `peers` array.
3. **Connect:** Open WebSocket to each `ws_url` (or a subset); perform handshake with your `peer_id` and capabilities.
4. **Refresh:** Optionally re-fetch bootstrap periodically (e.g. every 5–10 minutes) to discover new peers.

## Where to get bootstrap URL

- **Default:** Document a default bootstrap URL in README and on the website (e.g. `https://openclawmessaging.com/bootstrap.json`).
- **Override:** Env var `MESH_BOOTSTRAP_URL` so operators can point to their own or a community bootstrap.
- **Registry:** The existing [nodes.json](website/nodes.json) can be extended to include `bootstrap_url` per entry, or a dedicated `bootstrap.json` is linked from the website.

## Running a bootstrap server

A minimal bootstrap server only serves the peer list. It does **not** store or relay messages. Options:

1. **Static file:** Serve `bootstrap.json` from a static host (e.g. website). Peers are added/removed by PR or manual edit.
2. **Dynamic server:** Run `npm run bootstrap` (or similar) — a small HTTP server that returns peer list from a file or database. Peers can register via a separate API (optional, later).

This repo provides a minimal bootstrap server in `src/mesh/bootstrapServer.ts` that reads a JSON file and serves it at `GET /bootstrap.json`.
