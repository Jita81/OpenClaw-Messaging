-- Mesh P2P: local message store (dedup by message_id)
CREATE TABLE IF NOT EXISTS mesh_messages (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,
  payload TEXT,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mesh_messages_channel ON mesh_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_mesh_messages_timestamp ON mesh_messages(channel_id, timestamp);
