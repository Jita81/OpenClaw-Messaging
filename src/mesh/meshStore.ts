/**
 * Local store for mesh messages. Dedup by message_id; append-only per channel.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type MeshMessage = {
  message_id: string;
  channel_id: string;
  sender_id: string;
  body: string;
  payload: string | null;
  timestamp: string;
};

const MESH_SCHEMA = `
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
`;

let db: Database.Database | null = null;

export function initMeshStore(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const database = new Database(dbPath);
  database.exec(MESH_SCHEMA);
  db = database;
  return database;
}

function getDb(): Database.Database {
  if (!db) throw new Error("mesh store not initialized");
  return db;
}

/** Insert message; ignore if message_id already exists (dedup). Returns true if inserted. */
export function insertMeshMessage(m: MeshMessage): boolean {
  const database = getDb();
  try {
    database
      .prepare(
        `INSERT INTO mesh_messages (message_id, channel_id, sender_id, body, payload, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(m.message_id, m.channel_id, m.sender_id, m.body, m.payload ?? null, m.timestamp);
    return true;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "SQLITE_CONSTRAINT")
      return false;
    throw e;
  }
}

/** Get messages for a channel, optionally after/before a message_id, ordered by timestamp. */
export function getMeshMessages(
  channelId: string,
  opts: { afterMessageId?: string; beforeMessageId?: string; limit?: number } = {}
): MeshMessage[] {
  const database = getDb();
  const limit = Math.min(opts.limit ?? 100, 500);
  let sql = `SELECT message_id, channel_id, sender_id, body, payload, timestamp FROM mesh_messages WHERE channel_id = ?`;
  const params: (string | number)[] = [channelId];
  if (opts.afterMessageId) {
    sql += ` AND timestamp > (SELECT timestamp FROM mesh_messages WHERE message_id = ?)`;
    params.push(opts.afterMessageId);
  }
  if (opts.beforeMessageId) {
    sql += ` AND timestamp < (SELECT timestamp FROM mesh_messages WHERE message_id = ?)`;
    params.push(opts.beforeMessageId);
  }
  sql += opts.beforeMessageId ? ` ORDER BY timestamp DESC LIMIT ?` : ` ORDER BY timestamp ASC LIMIT ?`;
  params.push(limit);
  const rows = database.prepare(sql).all(...params) as MeshMessage[];
  if (opts.beforeMessageId) rows.reverse();
  return rows;
}

export function hasMeshMessage(messageId: string): boolean {
  const database = getDb();
  const row = database.prepare("SELECT 1 FROM mesh_messages WHERE message_id = ?").get(messageId);
  return !!row;
}
