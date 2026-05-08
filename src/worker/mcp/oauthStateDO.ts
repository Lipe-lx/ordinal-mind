import type { AuthRequest } from "@cloudflare/workers-oauth-provider"

const STATE_TTL_MS = 15 * 60 * 1000

export interface McpOAuthPendingState {
  created_at: string
  code_verifier: string
  oauth_request: AuthRequest
  redirect_origin_fingerprint: string
  version: number
}

type IssueBody = {
  state: string
  payload: McpOAuthPendingState
  expires_at: number
}

type ConsumeBody = {
  state: string
  code_fingerprint?: string
}

type PeekBody = {
  state: string
}

type StoredState = {
  payload: McpOAuthPendingState
  expires_at: number
}

type ConsumedMarker = {
  consumed_at: number
  expires_at: number
  code_fingerprint: string | null
}

const CONSUMED_MARKER_TTL_MS = 60 * 1000

const DurableObjectBase = (globalThis as { DurableObject?: new (...args: any[]) => any }).DurableObject
  ?? class {
    protected ctx: DurableObjectState
    constructor(ctx: DurableObjectState) {
      this.ctx = ctx
    }
  }

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export class McpOAuthStateDO extends DurableObjectBase {
  private kv = this.ctx.storage
  private consumedKey(state: string): string {
    return `consumed:${state}`
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === "POST" && url.pathname === "/issue") {
      const body = parseJson<IssueBody>(await request.text())
      if (!body?.state || !body.payload || !Number.isFinite(body.expires_at)) {
        return json({ ok: false, error: "invalid_issue_payload" }, 400)
      }
      await this.kv.put(body.state, {
        payload: body.payload,
        expires_at: body.expires_at,
      } satisfies StoredState)
      return json({ ok: true })
    }

    if (request.method === "POST" && url.pathname === "/consume") {
      const body = parseJson<ConsumeBody>(await request.text())
      if (!body?.state) {
        return json({ ok: false, error: "invalid_consume_payload" }, 400)
      }
      const now = Date.now()
      const outcome = await this.kv.transaction(async (txn) => {
        const row = await txn.get<StoredState>(body.state)
        if (!row) {
          const consumed = await txn.get<ConsumedMarker>(this.consumedKey(body.state))
          if (consumed && consumed.expires_at > now) {
            const sameFingerprint = Boolean(
              consumed.code_fingerprint
              && body.code_fingerprint
              && consumed.code_fingerprint === body.code_fingerprint
            )
            return {
              ok: false as const,
              cause: sameFingerprint ? "replay_duplicate" as const : "replay" as const,
            }
          }
          return { ok: false as const, cause: "missing" as const }
        }
        if (row.expires_at <= now) {
          await txn.delete(body.state)
          return { ok: false as const, cause: "expired" as const }
        }
        await txn.delete(body.state)
        await txn.put(this.consumedKey(body.state), {
          consumed_at: now,
          expires_at: now + CONSUMED_MARKER_TTL_MS,
          code_fingerprint: body.code_fingerprint ?? null,
        } satisfies ConsumedMarker)
        return { ok: true as const, payload: row.payload }
      })
      if (!outcome.ok) return json(outcome, 404)
      return json({ ok: true, payload: outcome.payload })
    }

    if (request.method === "POST" && url.pathname === "/peek") {
      const body = parseJson<PeekBody>(await request.text())
      if (!body?.state) {
        return json({ ok: false, error: "invalid_peek_payload" }, 400)
      }
      const row = await this.kv.get<StoredState>(body.state)
      if (!row) return json({ ok: false, cause: "missing" }, 404)
      return json({ ok: true, payload: row.payload, expires_at: row.expires_at })
    }

    if (request.method === "POST" && url.pathname === "/sweep") {
      const now = Date.now()
      const listed = await this.kv.list<StoredState>()
      let deleted = 0
      for (const [key, value] of listed.entries()) {
        if (value.expires_at <= now) {
          await this.kv.delete(key)
          deleted += 1
        }
      }
      return json({ ok: true, deleted })
    }

    return json({ ok: false, error: "not_found" }, 404)
  }

  // Utility for callers that need the canonical expiration in millis.
  static ttlMs(): number {
    return STATE_TTL_MS
  }
}
