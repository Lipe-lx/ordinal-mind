# Cloudflare Setup — Ordinal Mind

## wrangler.jsonc

The project uses `wrangler.jsonc` for Cloudflare Workers and Pages configuration.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ordinal-mind",
  "main": "src/worker/index.ts",
  "compatibility_date": "2025-02-04",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    "ENVIRONMENT": "production"
  },
  "kv_namespaces": [
    {
      "binding": "CHRONICLES_KV",
      "id": "<your-kv-namespace-id>"
    }
  ],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS"
  },
  "observability": {
    "enabled": true
  }
}
```

## Project Creation & KV Setup

```bash
# Create KV namespace
npx wrangler kv namespace create CHRONICLES_KV
# Copy the generated ID to wrangler.jsonc

# Local development with KV
npx wrangler dev
```

## package.json (Relevant Scripts)

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "deploy": "npm run build && wrangler deploy",
    "types": "wrangler types",
    "typecheck": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "cbor": "^10.0.12",
    "motion": "^12.0.0",
    "react": "^19.0.0",
    "react-router": "^7.0.0"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1.0.0",
    "wrangler": "^3.0.0"
  }
}
```

## Worker Entrypoint (src/worker/index.ts)

The orchestrator handles both standard JSON responses and SSE streaming for real-time progress.

```typescript
// src/worker/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/api/chronicle") {
      const id = url.searchParams.get("id")
      const useStream = url.searchParams.get("stream") === "1"

      if (useStream) {
        return handleStreamingChronicle(id, env)
      } else {
        return handleStandardChronicle(id, env)
      }
    }

    return env.ASSETS.fetch(request)
  }
}
```

## Cache Strategy (src/worker/cache.ts)

```typescript
// src/worker/cache.ts
export async function cachePut(kv: KVNamespace, id: string, chronicle: Chronicle): Promise<void> {
  const genesisTs = new Date(chronicle.meta.genesis_timestamp).getTime()
  const isRecent = Date.now() - genesisTs < (30 * 24 * 60 * 60 * 1000) // 30 days
  
  // Immutables (old inscriptions) = 30 days TTL
  // Recent/Active = shorter TTL
  const ttl = isRecent ? 3600 : 2592000 

  await kv.put(id, JSON.stringify(chronicle), { expirationTtl: ttl })
}
```
