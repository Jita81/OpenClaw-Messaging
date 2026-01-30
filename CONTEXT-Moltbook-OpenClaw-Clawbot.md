# Context: Moltbook, OpenClaw & Clawbot

A short reference on what these are and how they relate.

---

## Summary

| Term | What it is |
|------|------------|
| **OpenClaw** | Open-source software to run your own personal AI agent. You install it; your “agent” runs on your machine. |
| **Clawbot / Moltbot** | The AI agent that runs when you use OpenClaw. Originally “Clawbot”; now officially **Moltbot** (trademark). |
| **Moltbook** | A social network for AI agents: agents sign up, post, discuss, upvote. Humans can observe. Part of the same ecosystem as OpenClaw. |

---

## 1. OpenClaw

**Website:** [openclaw.ai](https://openclaw.ai)

OpenClaw is an **open-source personal AI assistant** that runs on your own machine (Mac, Windows, Linux). It’s the *software* you install; the *agent* you get is Clawbot/Moltbot.

### What it does

- **Runs locally** – Your data stays on your machine; works with Anthropic, OpenAI, or local models.
- **Real tasks** – Manages email, calendar, web browsing, shell commands, scripts, flights, etc., not just chat.
- **Messaging** – You talk to it via WhatsApp, Telegram, Discord, Slack, Signal, iMessage, and others.
- **Memory & context** – Persistent memory and context (often described as “24/7”).
- **Skills & plugins** – Community skills and the ability to add or let the agent create its own.
- **Browser & system** – Can control the browser, read/write files, run commands (configurable/sandboxable).

### Creator & ecosystem

- Created by **Peter Steinberger** (@steipete).
- Often described as “Claude with hands” or a practical “Jarvis”: an agent that can actually do things on your computer and in your apps.
- Install: one-liner script, npm (`clawdbot`), or from source (GitHub: `openclaw/openclaw`, run via `moltbot` in the repo).

So: **OpenClaw = the platform; Clawbot/Moltbot = the agent that runs on it.**

---

## 2. Clawbot → Moltbot

**Current product site:** [clawbot.ai](https://clawbot.ai) / [moltbot.io](https://moltbot.io)  
**Docs:** [docs.clawd.bot](https://docs.clawd.bot)

“Clawbot” was the original name of the viral AI agent that runs on OpenClaw. It was **renamed to Moltbot** after **Anthropic** (Claude) raised trademark concerns over “Claw”-related naming.

- **Clawbot** = original name (still used informally).
- **Moltbot** = current official name.
- **Mascot** – Originally “Claw” (lobster); now **Molty**. “Molt” refers to how lobsters grow (molting).

So in practice:

- **Clawbot** and **Moltbot** refer to the same agent.
- **OpenClaw** is the open-source project you install; it runs the Moltbot/Clawbot agent.
- The npm package is still `clawdbot`; the repo and docs use both “openclaw” and “moltbot.”

### What the agent does

- Proactive, 24/7-style assistance (cron, reminders, background tasks).
- Email, calendar, support-style workflows, code (e.g. tests, PRs), monitoring.
- Communication over WhatsApp, Telegram, Discord, Slack, iMessage, etc.
- Often self-hosted; you pay for model APIs and (optionally) hosting, not for the agent software itself.

---

## 3. Moltbook

**Website:** [moltbook.com](https://www.moltbook.com)

Moltbook is a **social network for AI agents**. It’s described as **“the front page of the agent internet.”**

### What it is

- **For agents** – AI agents can sign up, have profiles, post, comment, and upvote.
- **For humans** – Humans can browse and observe; the primary participants are agents.
- **Communities** – “Submolts” work like community sections (similar in concept to subreddits).
- **Reputation** – Karma and “top agents” lists.
- **Connection to OpenClaw** – Moltbook explicitly says: *“Don’t have an AI agent? Create one at [openclaw.ai](https://openclaw.ai).”*

So agents you create and run with **OpenClaw (Moltbot/Clawbot)** can, in principle, be the same kind of agents that join and participate on **Moltbook**.

---

## How they fit together

```
┌─────────────────────────────────────────────────────────────────┐
│  OPENCLAW (openclaw.ai)                                         │
│  Open-source software you install on your machine               │
│  → Runs the agent (Clawbot/Moltbot)                             │
│  → Talks to you via WhatsApp, Telegram, Discord, etc.           │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                │  Your agent (Moltbot) can
                                │  have an account on…
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  MOLTBOOK (moltbook.com)                                        │
│  Social network for AI agents                                   │
│  → Agents post, comment, upvote, build karma                    │
│  → “Front page of the agent internet”                           │
└─────────────────────────────────────────────────────────────────┘
```

- **OpenClaw** = run your own agent.
- **Clawbot/Moltbot** = that agent (old name → new name).
- **Moltbook** = place where agents (including ones run with OpenClaw) can have a presence and interact with other agents.

---

## Naming quick reference

| You might see | Meaning |
|---------------|--------|
| OpenClaw | The open-source project and product (openclaw.ai). |
| Claw / “my Claw” | The agent running on OpenClaw (informal). |
| Clawbot | Original name for that agent; still used colloquially. |
| Moltbot | Current official name for the same agent (post–Anthropic rename). |
| clawdbot | npm package name; GitHub org/repo names. |
| Moltbook | Social network for agents; part of the same ecosystem. |
| Molty | Current mascot (lobster). |

---

## Why “OpenClaw Messaging” makes sense

Your repo name **OpenClaw Messaging** fits this context: OpenClaw/Moltbot is all about talking to your agent over **messaging** (WhatsApp, Telegram, Discord, Slack, iMessage, etc.). So “OpenClaw Messaging” can reasonably mean:

- Messaging integrations for OpenClaw, or  
- Messaging-related tooling/docs for the OpenClaw/Moltbot ecosystem.

This document gives you the shared context for Moltbook, OpenClaw, and Clawbot so you can use the names consistently in docs, code, or specs.
