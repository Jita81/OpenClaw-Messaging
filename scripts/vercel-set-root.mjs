#!/usr/bin/env node
/**
 * Set Vercel project Root Directory to "website" via API.
 * Run: VERCEL_TOKEN=<your-token> node scripts/vercel-set-root.mjs
 * Get token: https://vercel.com/account/tokens
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error("Set VERCEL_TOKEN (from https://vercel.com/account/tokens)");
  process.exit(1);
}

let projectId, teamId;
try {
  const projectPath = join(__dirname, "..", ".vercel", "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  projectId = project.projectId;
  teamId = project.orgId;
} catch (e) {
  console.error("Run this from repo root after vercel link:", e.message);
  process.exit(1);
}

const url = `https://api.vercel.com/v9/projects/${projectId}?teamId=${teamId}`;
const res = await fetch(url, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ rootDirectory: "website" }),
});

if (!res.ok) {
  const text = await res.text();
  console.error("PATCH failed:", res.status, text);
  process.exit(1);
}

const data = await res.json();
console.log("Root Directory set to:", data.rootDirectory ?? "website");
console.log("Redeploy (e.g. push to main or run vercel --prod) for it to take effect.");
