# Cloudflare Setup — Ordinal Mind

## wrangler.toml

```toml
name = "ordinal-mind-worker"
main = "src/worker/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
ENVIRONMENT = "production"

[[kv_namespaces]]
binding = "CHRONICLES_KV"
id = "<seu-kv-namespace-id>"
preview_id = "<seu-preview-kv-id>"

[site]
bucket = "./dist/app"

[build]
command = "npm run build"

[[rules]]
type = "ESModule"
globs = ["**/*.ts"]
```

## Criação do projeto

```bash
npm create cloudflare@latest ordinal-mind -- --type worker
cd ordinal-mind
npm install

# criar KV namespace
npx wrangler kv namespace create CHRONICLES_KV
# copiar o ID gerado para o wrangler.toml

# para preview local
npx wrangler kv namespace create CHRONICLES_KV --preview
```

## package.json (scripts relevantes)

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "build": "tsc && vite build --outDir dist/app",
    "deploy": "npm run build && wrangler deploy",
    "types": "wrangler types"
  },
  "dependencies": {
    "react": "^18",
    "react-dom": "^18"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4",
    "typescript": "^5",
    "vite": "^5",
    "wrangler": "^3"
  }
}
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/worker/**/*.ts"]
}
```

## Worker entrypoint (src/worker/index.ts)

```typescript
import { resolveInput } from "./resolver"
import { fetchMempool } from "./agents/mempool"
import { fetchOrdinals } from "./agents/ordinals"
import { scrapeXMentions } from "./agents/xsearch"
import { buildTimeline } from "./timeline"
import { cacheGet, cachePut } from "./cache"

export interface Env {
  CHRONICLES_KV: KVNamespace
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  ENVIRONMENT: string
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === "OPTIONS")
      return new Response(null, { headers: CORS_HEADERS })

    if (url.pathname.startsWith("/api/"))
      return handleApi(url, env)

    return env.ASSETS.fetch(request)
  },
}

async function handleApi(url: URL, env: Env): Promise<Response> {
  if (url.pathname === "/api/chronicle") {
    const raw = url.searchParams.get("id")
    if (!raw) return jsonResponse({ error: "id parameter is required" }, 400)

    try {
      const resolved = await resolveInput(raw)

      if (resolved.type === "address") {
        // Fallback to external indexer for address lookup as it's the only free endpoint available for this
        const res = await fetch(`https://api-3.xverse.app/v1/address/${resolved.value}/ordinals/inscriptions`)
        if (!res.ok) return jsonResponse({ error: "Address lookup failed" }, 500)
        const data = await res.json() as { results: { id: string, number: number, content_url: string }[] }
        const inscriptions = (data.results || []).map(r => ({ id: r.id, number: r.number, content_url: r.content_url }))
        return jsonResponse({ type: "address", inscriptions })
      }

      const id = resolved.value

      const cached = await cacheGet(env.CHRONICLES_KV, id)
      if (cached) return jsonResponse({ ...cached, from_cache: true })

      let meta: any = null
      try {
        meta = await fetchOrdinals.inscription(id)
      } catch (err) {
        return jsonResponse({ error: "Inscription not found" }, 404)
      }

      const genesisTxId = id.split("i")[0]
      const currentTxId = meta.last_transfer?.tx_id

      const [transfers, xMentions] = await Promise.allSettled([
        currentTxId && currentTxId !== genesisTxId
          ? fetchMempool.traceTransfers(currentTxId, genesisTxId, 20)
          : Promise.resolve([]),
        scrapeXMentions(id),
      ])

      const enrichedTransfers = transfers.status === "fulfilled" ? transfers.value : []
      const mentions = xMentions.status === "fulfilled" ? xMentions.value : []

      const events = buildTimeline(meta, enrichedTransfers, null, mentions)
      const chronicle = { inscription_id: id, meta, events, cached_at: new Date().toISOString() }

      try { await cachePut(env.CHRONICLES_KV, id, chronicle) } catch (err) { }

      return jsonResponse(chronicle)

    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error"
      const status = message.includes("not found") ? 404 : 500
      return jsonResponse({ error: message }, status)
    }
  }

  return jsonResponse({ error: "Not found" }, 404)
}
```

## resolver.ts

```typescript
// detecta se o input é inscription number, inscription hex ID, ou taproot address

export interface ResolvedInput {
  type: "inscription" | "address"
  value: string   // inscription_id (hex) ou endereço normalizado
}

const TAPROOT_RE = /^bc1p[a-z0-9]{38,62}$/i
const HEX_ID_RE  = /^[a-f0-9]{64}i[0-9]+$/i
const NUMBER_RE  = /^\d+$/

export async function resolveInput(raw: string): Promise<ResolvedInput> {
  const v = raw.trim()

  if (TAPROOT_RE.test(v)) return { type: "address", value: v.toLowerCase() }
  if (HEX_ID_RE.test(v)) return { type: "inscription", value: v.toLowerCase() }

  if (NUMBER_RE.test(v)) {
    const id = await resolveNumberToId(parseInt(v, 10))
    return { type: "inscription", value: id }
  }

  throw new Error("invalid input: use inscription number, hex ID, or bc1p address")
}

async function resolveNumberToId(num: number): Promise<string> {
  const res = await fetch(`https://ordinals.com/inscription/${num}`)
  if (!res.ok) throw new Error(`inscription #${num} not found`)
  
  const html = await res.text()
  const match = html.match(/\/inscription\/([a-f0-9]{64}i[0-9]+)/i)
  
  if (match && match[1]) return match[1]
  
  throw new Error(`inscription #${num} id could not be resolved`)
}
```

## cache.ts

```typescript
import type { Chronicle } from "../app/lib/types"

// TTL strategy: dados on-chain imutáveis = 30 dias; recentes = 1h
const TTL = {
  default: 60 * 60 * 24 * 30,  // 30 dias
  recent:  60 * 60,             // 1h — para inscrições com < 7 dias
} as const

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function cacheGet(kv: KVNamespace, id: string): Promise<Chronicle | null> {
  const raw = await kv.get(id)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export async function cachePut(kv: KVNamespace, id: string, chronicle: Chronicle): Promise<void> {
  const genesisTs = new Date(chronicle.meta.genesis_timestamp).getTime()
  const isRecent = Date.now() - genesisTs < SEVEN_DAYS_MS
  const ttl = isRecent ? TTL.recent : TTL.default

  await kv.put(id, JSON.stringify(chronicle), { expirationTtl: ttl })
}
```
