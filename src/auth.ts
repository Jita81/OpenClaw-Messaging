import { createHash, randomUUID } from "crypto";

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

export function generateApiKey(): string {
  return "claw_" + randomUUID().replace(/-/g, "") + "_" + Math.random().toString(36).slice(2, 12);
}
