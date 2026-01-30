import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findSchemaPath(): string {
  const nextToDist = join(__dirname, "schema.sql");
  if (existsSync(nextToDist)) return nextToDist;
  return join(__dirname, "..", "src", "schema.sql");
}

export type Agent = {
  id: string;
  name: string;
  api_key_hash: string;
  created_at: string;
};

export type Channel = {
  id: string;
  name: string;
  header: string | null;
  public: number;
  dm: number;
  created_at: string;
};

export type PublicChannelRow = {
  id: string;
  name: string;
  header: string | null;
  member_count: number;
  created_at: string;
};

export type Message = {
  id: string;
  channel_id: string;
  agent_id: string;
  body: string;
  payload: string | null;
  created_at: string;
};

let db: Database.Database | null = null;

export function initDb(dbPath: string): Database.Database {
  const schemaPath = findSchemaPath();
  const schema = readFileSync(schemaPath, "utf-8");
  db = new Database(dbPath);
  // WAL mode required for concurrency (must be set before other operations)
  db.pragma("journal_mode = WAL");
  const modeRow = db.prepare("PRAGMA journal_mode").get() as { journal_mode?: string } | undefined;
  const modeStr = modeRow?.journal_mode ?? "";
  if (modeStr.toLowerCase() !== "wal") {
    console.error("SQLite WAL mode required. Got journal_mode:", modeStr);
    process.exit(1);
  }
  db.exec(schema);
  // Migrations for existing DBs (add columns if missing)
  try {
    db.exec("ALTER TABLE channels ADD COLUMN public INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* column may already exist */
  }
  try {
    db.exec("ALTER TABLE channels ADD COLUMN dm INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* column may already exist */
  }
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("DB not initialized");
  return db;
}

function randomId(): string {
  return randomUUID();
}

// --- Agents ---
export function createAgent(name: string, apiKeyHash: string): { id: string; name: string; api_key_hash: string; created_at: string } {
  const id = randomId();
  getDb().prepare("INSERT INTO agents (id, name, api_key_hash) VALUES (?, ?, ?)").run(id, name, apiKeyHash);
  const row = getDb().prepare("SELECT id, name, api_key_hash, created_at FROM agents WHERE id = ?").get(id) as Agent;
  return row;
}

export function getAgentByApiKeyHash(apiKeyHash: string): Agent | undefined {
  return getDb().prepare("SELECT id, name, api_key_hash, created_at FROM agents WHERE api_key_hash = ?").get(apiKeyHash) as Agent | undefined;
}

export function getAgentById(id: string): Agent | undefined {
  return getDb().prepare("SELECT id, name, api_key_hash, created_at FROM agents WHERE id = ?").get(id) as Agent | undefined;
}

export function getAgentByName(name: string): Agent | undefined {
  return getDb().prepare("SELECT id, name, api_key_hash, created_at FROM agents WHERE name = ?").get(name) as Agent | undefined;
}

// --- Channels ---
export function createChannel(name: string, header?: string | null, isPublic?: boolean, isDm?: boolean): Channel {
  const id = randomId();
  const pub = isPublic ? 1 : 0;
  const dm = isDm ? 1 : 0;
  getDb().prepare("INSERT INTO channels (id, name, header, public, dm) VALUES (?, ?, ?, ?, ?)").run(id, name, header ?? null, pub, dm);
  return getDb().prepare("SELECT id, name, header, public, dm, created_at FROM channels WHERE id = ?").get(id) as Channel;
}

export function getChannel(id: string): Channel | undefined {
  return getDb().prepare("SELECT id, name, header, public, dm, created_at FROM channels WHERE id = ?").get(id) as Channel | undefined;
}

export function getChannelByName(name: string): Channel | undefined {
  return getDb().prepare("SELECT id, name, header, public, dm, created_at FROM channels WHERE name = ?").get(name) as Channel | undefined;
}

export function listChannels(agentId?: string, dmFilter?: boolean): Channel[] {
  if (agentId !== undefined) {
    let sql =
      "SELECT c.id, c.name, c.header, c.public, c.dm, c.created_at FROM channels c INNER JOIN channel_members m ON c.id = m.channel_id WHERE m.agent_id = ?";
    const params: (string | number)[] = [agentId];
    if (dmFilter === true) {
      sql += " AND c.dm = 1";
    } else if (dmFilter === false) {
      sql += " AND c.dm = 0";
    }
    sql += " ORDER BY c.created_at DESC";
    return getDb().prepare(sql).all(...params) as Channel[];
  }
  return getDb().prepare("SELECT id, name, header, public, dm, created_at FROM channels ORDER BY created_at DESC").all() as Channel[];
}

export function listPublicChannels(): PublicChannelRow[] {
  return getDb()
    .prepare(
      `SELECT c.id, c.name, c.header, c.created_at,
        (SELECT COUNT(*) FROM channel_members m WHERE m.channel_id = c.id) AS member_count
       FROM channels c WHERE c.public = 1 ORDER BY c.created_at DESC`
    )
    .all() as PublicChannelRow[];
}

// --- Channel members ---
export function addChannelMember(channelId: string, agentId: string): void {
  getDb().prepare("INSERT OR IGNORE INTO channel_members (channel_id, agent_id) VALUES (?, ?)").run(channelId, agentId);
}

export function removeChannelMember(channelId: string, agentId: string): void {
  getDb().prepare("DELETE FROM channel_members WHERE channel_id = ? AND agent_id = ?").run(channelId, agentId);
}

export function isChannelMember(channelId: string, agentId: string): boolean {
  const row = getDb().prepare("SELECT 1 FROM channel_members WHERE channel_id = ? AND agent_id = ?").get(channelId, agentId);
  return !!row;
}

export function getChannelMemberCount(channelId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM channel_members WHERE channel_id = ?").get(channelId) as { n: number };
  return row?.n ?? 0;
}

export function getAgentCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number };
  return row?.n ?? 0;
}

// --- Messages ---
export function createMessage(channelId: string, agentId: string, body: string, payload?: string | null): Message {
  const id = randomId();
  getDb().prepare("INSERT INTO messages (id, channel_id, agent_id, body, payload) VALUES (?, ?, ?, ?, ?)").run(id, channelId, agentId, body, payload ?? null);
  return getDb().prepare("SELECT id, channel_id, agent_id, body, payload, created_at FROM messages WHERE id = ?").get(id) as Message;
}

export function getMessageById(id: string): Message | undefined {
  return getDb().prepare("SELECT id, channel_id, agent_id, body, payload, created_at FROM messages WHERE id = ?").get(id) as Message | undefined;
}

export function getMessages(channelId: string, limit: number, beforeId?: string | null): Message[] {
  if (beforeId) {
    const before = getDb().prepare("SELECT created_at FROM messages WHERE id = ? AND channel_id = ?").get(beforeId, channelId) as { created_at: string } | undefined;
    if (!before) return [];
    return getDb()
      .prepare(
        "SELECT id, channel_id, agent_id, body, payload, created_at FROM messages WHERE channel_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?"
      )
      .all(channelId, before.created_at, limit) as Message[];
  }
  return getDb()
    .prepare("SELECT id, channel_id, agent_id, body, payload, created_at FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(channelId, limit) as Message[];
}

/** Delete messages older than retentionDays. Call with 0 to skip. Returns number deleted. */
export function pruneOldMessages(retentionDays: number): number {
  if (retentionDays <= 0) return 0;
  const modifier = `-${retentionDays} days`;
  const result = getDb().prepare("DELETE FROM messages WHERE datetime(created_at) < datetime('now', ?)").run(modifier);
  return result.changes;
}
