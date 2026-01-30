/**
 * Mesh identity: Ed25519 keypair for peer_id and message signing.
 * peer_id = base64(public key raw bytes). Messages are signed over canonical payload.
 */
import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const ALG = null; // Ed25519 uses null for sign/verify

export type KeyPair = {
  publicKey: string;
  privateKey: string;
};

/** Generate a new Ed25519 keypair (PEM). */
export function generateKeypair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

/** Load keypair from directory: key.pem (private) and pub.pem (public). Create if missing. */
export function loadOrCreateKeypair(keyDir: string): KeyPair {
  const keyPath = `${keyDir}/key.pem`;
  const pubPath = `${keyDir}/pub.pem`;
  if (existsSync(keyPath) && existsSync(pubPath)) {
    return {
      privateKey: readFileSync(keyPath, "utf8"),
      publicKey: readFileSync(pubPath, "utf8"),
    };
  }
  const dir = dirname(keyPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const pair = generateKeypair();
  writeFileSync(keyPath, pair.privateKey, { mode: 0o600 });
  writeFileSync(pubPath, pair.publicKey);
  return pair;
}

/** Derive peer_id from public key: base64 of raw 32-byte public key. */
export function publicKeyToPeerId(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem);
  const raw = key.export({ type: "spki", format: "der" }) as Buffer;
  const seed = raw.subarray(-32);
  return seed.toString("base64url");
}

/** Canonical string for signing: sorted JSON of message fields (no whitespace). */
export function messageCanonical(msg: {
  message_id: string;
  channel_id: string;
  sender_id: string;
  body: string;
  payload?: string | null;
  timestamp: string;
}): string {
  const obj = {
    message_id: msg.message_id,
    channel_id: msg.channel_id,
    sender_id: msg.sender_id,
    body: msg.body,
    payload: msg.payload ?? null,
    timestamp: msg.timestamp,
  };
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/** Sign canonical message string; return base64 signature. */
export function signMessage(canonical: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const sig = sign(ALG, Buffer.from(canonical, "utf8"), key);
  return sig.toString("base64");
}

/** Verify signature (base64) over canonical string using public key (PEM or peer_id). */
export function verifyMessage(
  canonical: string,
  signatureB64: string,
  publicKeyPem: string
): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    const sig = Buffer.from(signatureB64, "base64");
    return verify(ALG, Buffer.from(canonical, "utf8"), key, sig);
  } catch {
    return false;
  }
}
