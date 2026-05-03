# 📜 Ordinal Mind

> **A Factual Chronicle Engine for Bitcoin Ordinals.**

Ordinal Mind is a verifiable memory engine for Bitcoin Ordinals. It transforms an inscription ID or taproot address into a temporal tree of events, backed by public on-chain data and enhanced by optional, client-side AI synthesis.

---

## ✨ Product Soul

- 🔍 **Factual First**: Timeline events are source-backed, chronologically deterministic, and verifiable.
- 🛡️ **Public Data Only**: Core functionality requires no login. Optional Discord Identity enables community consensus and OG contributions.
- 🔑 **BYOK AI (Client-Side)**: Your LLM keys stay in your browser. Authenticated users benefit from AES-256-GCM encrypted persistence.
- 📉 **Graceful Degradation**: If AI synthesis fails or is missing, the core factual timeline remains perfectly functional.

---

## 🚀 Key Features

- **🌐 Multi-Source Chronicle**: Aggregates data from Ordinals.com, Mempool.space, UniSat, and web discovery.
- **🌳 Genealogical Tree**: Visualizes the ancestry and provenance of any inscription.
- **💬 Chronicle Narrative**: Interactive BYOK chat for deep research, intent-aware and QA-optimized.
- **📚 Wiki & Consensus (L0-L2)**: Tiered knowledge base (Genesis/OG/Community) where contributors earn identity badges.
- **🆔 Discord Identity**: Secure PKCE-based OAuth with automated tier calculation based on server membership.
- **⚡ Real-time Scan**: SSE-powered progress tracking for deep asset resolution.

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

# Typecheck
npm run typecheck
```

---

## 📡 API Surface

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/chronicle` | `GET` | Resolve inscription metadata and events. |
| `/api/wiki/collection/:slug/consolidated` | `GET` | Retrieve the consensus-driven wiki for a collection. |
| `/api/wiki/contribute` | `POST` | Submit a knowledge contribution (requires Discord JWT). |
| `/api/auth/discord` | `GET` | Initiate Discord OAuth PKCE flow. |
| `/api/auth/me` | `GET` | Verify session and return identity profile. |

---

## 📖 Internal Documentation

- 🗺️ [**ARCHITECTURE.md**](./docs/ARCHITECTURE.md): Runtime flow and data layer.
- 🗺️ [**CODEBASE.md**](./docs/CODEBASE.md): Detailed file-by-file directory.
- 🤖 [**AGENTS.md**](./AGENTS.md): Core product rules and implementation constraints.

---

<p align="center">
  <i>Built for the Ordinals collector who values truth over hype.</i>
</p>
