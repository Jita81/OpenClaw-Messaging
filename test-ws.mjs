/**
 * WebSocket test: connect, subscribe, receive message when REST POST sends one.
 * Run with server already running. Usage: node test-ws.mjs [baseUrl]
 */
import WebSocket from "ws";

const BASE = process.argv[2] || "http://localhost:3000";
const WS_URL = BASE.replace(/^http/, "ws");

async function main() {
  // 1. Register two agents and create channel
  const reg1 = await fetch(`${BASE}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "WS-Test-Agent1" }),
  });
  const { api_key: key1 } = await reg1.json();
  if (!key1) {
    console.error("Failed to register agent 1");
    process.exit(1);
  }

  const reg2 = await fetch(`${BASE}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "WS-Test-Agent2" }),
  });
  const { api_key: key2 } = await reg2.json();
  if (!key2) {
    console.error("Failed to register agent 2");
    process.exit(1);
  }

  const chRes = await fetch(`${BASE}/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key1}` },
    body: JSON.stringify({ name: "#ws-test", header: "WebSocket test channel" }),
  });
  const channel = await chRes.json();
  const channelId = channel.id;
  if (!channelId) {
    console.error("Failed to create channel", channel);
    process.exit(1);
  }

  // Agent2 joins so it can subscribe
  await fetch(`${BASE}/channels/${channelId}/join`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key2}` },
  });

  // 2. Agent2 opens WebSocket and subscribes
  const wsUrl = `${WS_URL}/ws?api_key=${encodeURIComponent(key2)}`;
  const ws = new WebSocket(wsUrl);

  const received = [];
  const done = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Timeout waiting for WS message")), 5000);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      received.push(msg);
      if (msg.type === "message" && msg.body === "Ping from REST") {
        clearTimeout(t);
        resolve();
      }
    });
  });

  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  ws.send(JSON.stringify({ type: "subscribe", channel_id: channelId }));

  // 3. Agent1 sends message via REST
  await new Promise((r) => setTimeout(r, 100));
  const postRes = await fetch(`${BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key1}` },
    body: JSON.stringify({ body: "Ping from REST", payload: { test: true } }),
  });
  if (!postRes.ok) {
    console.error("Failed to POST message", await postRes.text());
    process.exit(1);
  }

  await done;
  ws.close();

  const msgEvent = received.find((m) => m.type === "message" && m.body === "Ping from REST");
  if (!msgEvent) {
    console.error("Did not receive expected message. Received:", received);
    process.exit(1);
  }
  if (msgEvent.payload?.test !== true) {
    console.error("Payload not received correctly", msgEvent);
    process.exit(1);
  }
  console.log("WebSocket test OK: received message with body and payload");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
