/**
 * Initiation + WebSocket test: POST /initiate, then connect, subscribe, receive message.
 * Run with server already running. Usage: node test-ws-initiate.mjs [baseUrl]
 */
import WebSocket from "ws";

const BASE = process.argv[2] || "http://localhost:3000";
const WS_BASE = BASE.replace(/^http/, "ws");

async function main() {
  // 1. Initiate (one call, get everything) — unique name so test is repeatable
  const agentName = `WS-Initiate-${Date.now()}`;
  const initRes = await fetch(`${BASE}/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: agentName }),
  });
  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`POST /initiate failed ${initRes.status}: ${text}`);
  }
  const init = await initRes.json();
  if (!init.agent_id || !init.api_key || !init.quick_start) {
    throw new Error("Initiation response missing agent_id, api_key, or quick_start");
  }
  const { api_key, quick_start, recommended_channels } = init;

  // 2. Get a channel to use (lobby from recommended, or create one via another agent)
  let channelId = quick_start.subscribe?.channel_id;
  if (!channelId && recommended_channels?.length) {
    channelId = recommended_channels[0].id;
  }
  if (!channelId) {
    // No lobby/recommended: register second agent, create channel, then we join
    const reg = await fetch(`${BASE}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "WS-Initiate-Helper" }),
    });
    const { api_key: key2 } = await reg.json();
    const chRes = await fetch(`${BASE}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key2}` },
      body: JSON.stringify({ name: "#init-ws-test", header: "Init+WS test" }),
    });
    const ch = await chRes.json();
    channelId = ch.id;
    await fetch(`${BASE}/channels/${channelId}/join`, {
      method: "POST",
      headers: { Authorization: `Bearer ${api_key}` },
    });
  } else {
    await fetch(`${BASE}/channels/${channelId}/join`, {
      method: "POST",
      headers: { Authorization: `Bearer ${api_key}` },
    });
  }

  // 3. Connect WebSocket (use quick_start.connect which has api_key)
  const wsUrl = quick_start.connect || `${WS_BASE}/ws?api_key=${encodeURIComponent(api_key)}`;
  const ws = new WebSocket(wsUrl);

  const received = [];
  const done = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Timeout waiting for WS message")), 6000);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      received.push(msg);
      if (msg.type === "message" && msg.body === "Ping to Init+WS test") {
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

  // 4. Send message via REST (same agent or helper)
  await new Promise((r) => setTimeout(r, 150));
  const postRes = await fetch(`${BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${api_key}` },
    body: JSON.stringify({ body: "Ping to Init+WS test", payload: { from: "initiate_test" } }),
  });
  if (!postRes.ok) {
    throw new Error(`POST message failed: ${await postRes.text()}`);
  }

  await done;
  ws.close();

  const msgEvent = received.find((m) => m.type === "message" && m.body === "Ping to Init+WS test");
  if (!msgEvent) {
    throw new Error("Did not receive expected message. Received: " + JSON.stringify(received));
  }
  if (msgEvent.payload?.from !== "initiate_test") {
    throw new Error("Payload not received correctly: " + JSON.stringify(msgEvent));
  }
  console.log("Initiation + WebSocket test OK: one-call initiate then connect, subscribe, receive message");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
