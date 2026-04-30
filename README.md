# 📜 Ordinal Mind

> **A Factual Chronicle Engine for Bitcoin Ordinals.**

Ordinal Mind is a verifiable memory engine for Bitcoin Ordinals. It transforms an inscription ID or taproot address into a temporal tree of events, backed by public on-chain data and enhanced by optional, client-side AI synthesis.

---

## ✨ Product Soul

- 🔍 **Factual First**: Timeline events are source-backed, chronologically deterministic, and verifiable.
- 🛡️ **Public Data Only**: No login, no wallet connect, and no paid APIs required. We only use what's on the open web.
- 🔑 **BYOK AI (Client-Side)**: Your LLM keys stay in your browser. The server never proxies, logs, or sees your secrets.
- 📉 **Graceful Degradation**: If AI synthesis fails or is missing, the core factual timeline remains perfectly functional.

---

## 🚀 Key Features

- **🌐 Multi-Source Chronicle**: Aggregates data from Ordinals.com, Mempool.space, UniSat, and web discovery.
- **🌳 Genealogical Tree**: Visualizes the ancestry and provenance of any inscription.
- **💬 Chronicle Narrative**: Interactive BYOK chat for deep research, intent-aware and QA-optimized.
- **📚 Wiki Layer (L0-L2)**: Persistent, D1-backed knowledge base that evolves with user research.
- **⚡ Real-time Scan**: SSE-powered progress tracking for deep asset resolution.
- **📊 Collector Widgets**: Specialized views for Rarity, Ownership, Sources, and Market Signals.

---

## 🛠️ Technology Stack

![React](https://img.shields.io/badge/React-19-blue?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)
![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare)
![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite)
![Motion](https://img.shields.io/badge/Motion-12-black)

---

## 🏁 Quick Start

### 1. Prerequisites
- **Node.js**: 20+
- **npm**: 10+

### 2. Installation
```bash
npm install
```

### 3. Local Development
```bash
# Initialize local database
npm run db:migrate:local

# Start dev server
npm run dev
```

### 4. Testing & Quality
```bash
# Run all tests
npm run test

# Run smoke tests
npm run test:smoke

# Typecheck
npm run typecheck
```

---

## 📡 API Surface

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/chronicle` | `GET` | Resolve inscription metadata and events. |
| `/api/wiki/:slug` | `GET` | Retrieve a wiki page by its slug. |
| `/api/wiki/ingest` | `POST` | Ingest new BYOK-generated wiki content. |
| `/api/wiki/health` | `GET` | Check D1 database health and schema state. |

---

## 📖 Internal Documentation

- 🗺️ [**ARCHITECTURE.md**](./ARCHITECTURE.md): Runtime flow and data layer.
- 🗺️ [**CODEBASE.md**](./CODEBASE.md): Detailed file-by-file directory.
- 🤖 [**AGENTS.md**](./AGENTS.md): Core product rules and implementation constraints.

---

<p align="center">
  <i>Built for the Ordinals collector who values truth over hype.</i>
</p>
