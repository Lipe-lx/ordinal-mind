import type { AuthRequest } from "@cloudflare/workers-oauth-provider"

const STATE_TTL_MS = 15 * 60 * 1000
const FLOW_RESULT_RETENTION_MS = 3 * 60 * 1000

export interface McpOAuthPendingState {
  created_at: string
  code_verifier: string
  oauth_request: AuthRequest
  redirect_origin_fingerprint: string
  version: number
}

export type McpOAuthFlowStatus =
  | "pending"
  | "user_redirected"
  | "callback_received"
  | "token_ready"
  | "expired"
  | "cancelled"
  | "replay_detected"
  | "failed"

export interface McpOAuthFlowRecord {
  flow_id: string
  state: string
  status: McpOAuthFlowStatus
  created_at: string
  updated_at: string
  expires_at: number
  authorize_url: string
  status_endpoint: string
  poll_after_ms: number
  result?: {
    error?: string
    hint?: string
    retryable?: boolean
    authorization_code?: string
    client_state?: string
    redirect_to?: string
  }
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

type FlowStartBody = {
  flow_id: string
  state: string
  authorize_url: string
  status_endpoint: string
  expires_at: number
  poll_after_ms: number
}

type FlowStatusBody = {
  flow_id: string
}

type FlowByStateBody = {
  state: string
}

type FlowUpdateBody = {
  flow_id: string
  status: McpOAuthFlowStatus
  error?: string
  hint?: string
  retryable?: boolean
  authorization_code?: string
  client_state?: string
  redirect_to?: string
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

type DurableObjectLikeCtor = new (
  ctx: DurableObjectState,
  env?: unknown
) => { ctx: DurableObjectState }

const DurableObjectBase: DurableObjectLikeCtor = (
  globalThis as { DurableObject?: DurableObjectLikeCtor }
).DurableObject
  ?? class {
    ctx: DurableObjectState
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
  private flowKey(flowId: string): string {
    return `flow:${flowId}`
  }
  private stateFlowKey(state: string): string {
    return `flow_by_state:${state}`
  }

  private nowIso(): string {
    return new Date().toISOString()
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
      const outcome = await this.kv.transaction(async (txn: DurableObjectTransaction) => {
        const row = await txn.get(body.state) as StoredState | undefined
        if (!row) {
          const consumed = await txn.get(this.consumedKey(body.state)) as ConsumedMarker | undefined
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
        const linkedFlowId = await txn.get(this.stateFlowKey(body.state)) as string | undefined
        if (linkedFlowId) {
          const flowKey = this.flowKey(linkedFlowId)
          const flow = await txn.get(flowKey) as McpOAuthFlowRecord | undefined
          if (flow) {
            const updatedAt = this.nowIso()
            flow.status = "callback_received"
            flow.updated_at = updatedAt
            await txn.put(flowKey, flow)
          }
        }
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
      const row = await this.kv.get(body.state) as StoredState | undefined
      if (!row) return json({ ok: false, cause: "missing" }, 404)
      return json({ ok: true, payload: row.payload, expires_at: row.expires_at })
    }

    if (request.method === "POST" && url.pathname === "/flow/start") {
      const body = parseJson<FlowStartBody>(await request.text())
      if (!body?.flow_id || !body?.state || !body.authorize_url || !body.status_endpoint || !Number.isFinite(body.expires_at)) {
        return json({ ok: false, error: "invalid_flow_start_payload" }, 400)
      }
      const nowIso = this.nowIso()
      const flow: McpOAuthFlowRecord = {
        flow_id: body.flow_id,
        state: body.state,
        status: "pending",
        created_at: nowIso,
        updated_at: nowIso,
        expires_at: body.expires_at,
        authorize_url: body.authorize_url,
        status_endpoint: body.status_endpoint,
        poll_after_ms: body.poll_after_ms,
      }
      await this.kv.put(this.flowKey(body.flow_id), flow)
      await this.kv.put(this.stateFlowKey(body.state), body.flow_id)
      return json({ ok: true })
    }

    if (request.method === "POST" && url.pathname === "/flow/status") {
      const body = parseJson<FlowStatusBody>(await request.text())
      if (!body?.flow_id) {
        return json({ ok: false, error: "invalid_flow_status_payload" }, 400)
      }
      const flow = await this.kv.get(this.flowKey(body.flow_id)) as McpOAuthFlowRecord | undefined
      if (!flow) return json({ ok: false, error: "flow_not_found" }, 404)
      if (flow.expires_at <= Date.now() && flow.status !== "token_ready" && flow.status !== "cancelled") {
        flow.status = "expired"
        flow.updated_at = this.nowIso()
        await this.kv.put(this.flowKey(body.flow_id), flow)
      }
      return json({ ok: true, flow })
    }

    if (request.method === "POST" && url.pathname === "/flow/by-state") {
      const body = parseJson<FlowByStateBody>(await request.text())
      if (!body?.state) {
        return json({ ok: false, error: "invalid_flow_by_state_payload" }, 400)
      }
      const flowId = await this.kv.get(this.stateFlowKey(body.state)) as string | undefined
      if (!flowId) return json({ ok: false, error: "flow_not_found" }, 404)
      const flow = await this.kv.get(this.flowKey(flowId)) as McpOAuthFlowRecord | undefined
      if (!flow) return json({ ok: false, error: "flow_not_found" }, 404)
      return json({ ok: true, flow })
    }

    if (request.method === "POST" && url.pathname === "/flow/update") {
      const body = parseJson<FlowUpdateBody>(await request.text())
      if (!body?.flow_id || !body?.status) {
        return json({ ok: false, error: "invalid_flow_update_payload" }, 400)
      }
      const key = this.flowKey(body.flow_id)
      const flow = await this.kv.get(key) as McpOAuthFlowRecord | undefined
      if (!flow) return json({ ok: false, error: "flow_not_found" }, 404)
      flow.status = body.status
      flow.updated_at = this.nowIso()
      if (body.error || body.hint || body.retryable !== undefined) {
        flow.result = {
          error: body.error,
          hint: body.hint,
          retryable: body.retryable,
          authorization_code: body.authorization_code,
          client_state: body.client_state,
          redirect_to: body.redirect_to,
        }
      } else if (body.authorization_code || body.client_state || body.redirect_to) {
        flow.result = {
          authorization_code: body.authorization_code,
          client_state: body.client_state,
          redirect_to: body.redirect_to,
        }
      }
      if (body.status === "token_ready") {
        flow.expires_at = Date.now() + FLOW_RESULT_RETENTION_MS
      }
      await this.kv.put(key, flow)
      return json({ ok: true, flow })
    }

    if (request.method === "POST" && url.pathname === "/sweep") {
      const now = Date.now()
      const listed = await this.kv.list() as { entries: () => IterableIterator<[string, StoredState]> }
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
