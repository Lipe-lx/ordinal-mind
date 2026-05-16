import { describe, expect, it, vi } from "vitest"
import { handleContribute, isFieldAllowedForSlug } from "../../src/worker/wiki/contribute"
import * as jwtModule from "../../src/worker/auth/jwt"
import type { Env } from "../../src/worker/index"

vi.mock("../../src/worker/auth/jwt")

describe("wikiContribute handler", () => {
  const mockEnv = {
    DB: {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn().mockResolvedValue(null),
    },
    AI: {
      run: vi.fn().mockResolvedValue({ response: "safe" }),
    },
    JWT_SECRET: "test-secret",
  } as unknown as Env

  const createRequest = (body: any, headers?: Record<string, string>) =>
    new Request("http://localhost/api/wiki/contribute", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })

  it("returns 400 for invalid body", async () => {
    const req = createRequest({ invalid: "data" })
    const res = await handleContribute(req, mockEnv)
    expect(res.status).toBe(400)
  })

  it("returns 400 for unknown field", async () => {
    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "unknown_field",
        value: "val",
        confidence: "stated_by_user",
        session_id: "s1",
      }
    })
    const res = await handleContribute(req, mockEnv)
    expect(res.status).toBe(400)
  })

  it("rejects human contribution without authenticated session", async () => {
    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "founder",
        value: "Satoshi",
        confidence: "stated_by_user",
        session_id: "s1",
      }
    })
    const res = await handleContribute(req, mockEnv)
    expect(res.status).toBe(401)
    const data = await res.json() as any
    expect(data.ok).toBe(false)
    expect(data.error).toBe("missing_auth_token")
  })

  it("enforces inscriber as inscription-only", () => {
    expect(isFieldAllowedForSlug("inscriber", "test-slug")).toBe(false)
    expect(isFieldAllowedForSlug("inscriber", `${"a".repeat(64)}i0`)).toBe(true)
  })

  it("rejects collection-scope inscriber contributions", async () => {
    vi.mocked(jwtModule.verifyJWT).mockResolvedValueOnce({
      sub: "123",
      tier: "community",
      username: "community_user",
      avatar: null,
      iat: 0,
      exp: 0,
    })

    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "inscriber",
        value: "Inscriber Name",
        confidence: "stated_by_user",
        session_id: "s1",
      },
    }, {
      Authorization: "Bearer fake-jwt",
    })

    const res = await handleContribute(req, mockEnv)
    expect(res.status).toBe(400)
    const data = await res.json() as any
    expect(data.ok).toBe(false)
    expect(data.error).toBe("field_scope_mismatch")
  })

  it("processes valid community contribution as published draft candidate", async () => {
    vi.mocked(jwtModule.verifyJWT).mockResolvedValueOnce({
      sub: "123",
      tier: "community",
      username: "community_user",
      avatar: null,
      iat: 0,
      exp: 0,
    })

    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "founder",
        value: "Satoshi",
        confidence: "stated_by_user",
        session_id: "s1",
      },
    }, {
      Authorization: "Bearer fake-jwt",
    })
    
    const res = await handleContribute(req, mockEnv)
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.ok).toBe(true)
    expect(data.status).toBe("published")
    expect(data.tier_applied).toBe("community")
  })

  it("stores public author snapshots for opted-in contributions", async () => {
    const executedStatements: Array<{ sql: string; params: unknown[] }> = []

    const db = {
      currentSql: "",
      currentParams: [] as unknown[],
      prepare(sql: string) {
        this.currentSql = sql
        return this
      },
      bind(...params: unknown[]) {
        this.currentParams = params
        return this
      },
      async all() {
        if (String(this.currentSql).toLowerCase().includes("pragma table_info('wiki_contributions')")) {
          return {
            results: [
              { name: "value_norm" },
              { name: "contributor_key" },
              { name: "updated_at" },
              { name: "public_author_mode" },
              { name: "public_author_username" },
              { name: "public_author_avatar_url" },
            ],
          }
        }
        return { results: [] }
      },
      async first() {
        return null
      },
      async run() {
        executedStatements.push({ sql: String(this.currentSql), params: [...this.currentParams] })
        return { success: true }
      },
    }

    const localMockEnv = {
      DB: db,
      AI: {
        run: vi.fn().mockResolvedValue({ response: "safe" }),
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    vi.mocked(jwtModule.verifyJWT).mockResolvedValueOnce({
      sub: "123",
      tier: "community",
      username: "community_user",
      avatar: "https://cdn.discordapp.com/avatars/123/community.png",
      iat: 0,
      exp: 0,
    })

    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "founder",
        value: "Satoshi",
        confidence: "stated_by_user",
        session_id: "s1",
        public_author_mode: "public",
      },
    }, {
      Authorization: "Bearer fake-jwt",
    })

    const res = await handleContribute(req, localMockEnv)
    expect(res.status).toBe(200)

    const insert = executedStatements.find((statement) => statement.sql.toLowerCase().includes("insert into wiki_contributions"))
    expect(insert?.params).toContain("public")
    expect(insert?.params).toContain("community_user")
    expect(insert?.params).toContain("https://cdn.discordapp.com/avatars/123/community.png")
  })

  it("processes valid OG contribution (published)", async () => {
    vi.mocked(jwtModule.verifyJWT).mockResolvedValueOnce({
      sub: "123",
      tier: "og",
      username: "og_user",
      avatar: null,
      iat: 0,
      exp: 0,
    })

    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "founder",
        value: "Satoshi",
        confidence: "stated_by_user",
        session_id: "s1",
      },
    }, {
      Authorization: "Bearer fake-jwt",
    })
    
    const res = await handleContribute(req, mockEnv)
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.ok).toBe(true)
    expect(data.status).toBe("published")
    expect(data.tier_applied).toBe("og")
  })

  it("returns duplicate status if contribution exists", async () => {
    // Mock DB to return an existing record
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ id: "existing", value: "Satoshi!", value_norm: "satoshi", status: "published" }),
      },
      AI: {
        run: vi.fn().mockResolvedValue({ response: "safe" }),
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    vi.mocked(jwtModule.verifyJWT).mockResolvedValueOnce({
      sub: "123",
      tier: "community",
      username: "community_user",
      avatar: null,
      iat: 0,
      exp: 0,
    })

    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "founder",
        value: "Satoshi",
        confidence: "stated_by_user",
        session_id: "s1",
      }
    }, {
      Authorization: "Bearer fake-jwt",
    })

    const res = await handleContribute(req, localMockEnv)
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.ok).toBe(true)
    expect(data.status).toBe("duplicate")
  })

  it("consolidates semantically equivalent values as duplicate", async () => {
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          id: "existing_semantic",
          value: "Sátoshi!!",
          value_norm: "satoshi",
          status: "published",
        }),
      },
      AI: {
        run: vi.fn().mockResolvedValue({ response: "safe" }),
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    vi.mocked(jwtModule.verifyJWT).mockResolvedValueOnce({
      sub: "123",
      tier: "community",
      username: "community_user",
      avatar: null,
      iat: 0,
      exp: 0,
    })

    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "founder",
        value: "satoshi",
        confidence: "stated_by_user",
        session_id: "s1",
      },
    }, {
      Authorization: "Bearer fake-jwt",
    })

    const res = await handleContribute(req, localMockEnv)
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.ok).toBe(true)
    expect(data.status).toBe("duplicate")
    expect(data.contribution_id).toBe("existing_semantic")
  })

  it("updates existing active contribution in-place when value changes", async () => {
    const first = vi.fn().mockResolvedValue({
      id: "existing_update",
      value: "Old founder",
      value_norm: "old founder",
      status: "published",
    })
    const run = vi.fn().mockResolvedValue({ success: true })
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first,
        run,
      },
      AI: {
        run: vi.fn().mockResolvedValue({ response: "safe" }),
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    vi.mocked(jwtModule.verifyJWT).mockResolvedValueOnce({
      sub: "123",
      tier: "community",
      username: "community_user",
      avatar: null,
      iat: 0,
      exp: 0,
    })

    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "founder",
        value: "New founder",
        confidence: "correcting_existing",
        session_id: "s1",
      },
    }, {
      Authorization: "Bearer fake-jwt",
    })

    const res = await handleContribute(req, localMockEnv)
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.ok).toBe(true)
    expect(data.status).toBe("published")
    expect(data.contribution_id).toBe("existing_update")
    expect(run).toHaveBeenCalled()
  })

  it("auto-publishes narrative seed contributions as system genesis", async () => {
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "collection:test",
        field: "founder",
        value: "Seed Founder",
        confidence: "inferred",
        verifiable: true,
        session_id: "seed-session",
        origin: "narrative_seed_agent",
      },
    })

    const res = await handleContribute(req, localMockEnv)
    const data = await res.json() as any
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.status).toBe("published")
    expect(data.tier_applied).toBe("genesis")
  })

  it("returns duplicate for seed when published value is semantically equal", async () => {
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          id: "seed_same",
          value: "Sátoshi!!",
          value_norm: "satoshi",
          status: "published",
          og_tier: "community",
          contributor_id: "user-1",
          contributor_key: "user:user-1",
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "collection:test",
        field: "founder",
        value: "satoshi",
        confidence: "inferred",
        verifiable: true,
        session_id: "seed-session",
        origin: "narrative_seed_agent",
      },
    })

    const res = await handleContribute(req, localMockEnv)
    const data = await res.json() as any
    expect(res.status).toBe(200)
    expect(data.status).toBe("duplicate")
    expect(data.contribution_id).toBe("seed_same")
  })

  it("updates existing seed-owned field for seed when value changes and clears consolidated cache", async () => {
    const prepare = vi.fn().mockReturnThis()
    const bind = vi.fn().mockReturnThis()
    const first = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "seed_update",
        value: "Old founder",
        value_norm: "old founder",
        status: "published",
        og_tier: "genesis",
        contributor_id: "system:narrative-seed-agent",
        contributor_key: "system:narrative-seed-agent",
      })
    const run = vi.fn().mockResolvedValue({ success: true })
    const localMockEnv = {
      DB: { prepare, bind, first, run },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "collection:test",
        field: "founder",
        value: "New founder",
        confidence: "inferred",
        verifiable: true,
        session_id: "seed-session",
        origin: "narrative_seed_agent",
      },
    })

    const res = await handleContribute(req, localMockEnv)
    const data = await res.json() as any
    expect(res.status).toBe(200)
    expect(data.status).toBe("published")
    expect(data.contribution_id).toBe("seed_update")
    expect(prepare.mock.calls.some((call) => String(call[0]).includes("DELETE FROM consolidated_cache"))).toBe(true)
  })

  it("does not overwrite divergent community-human field with seed updates", async () => {
    const run = vi.fn().mockResolvedValue({ success: true })
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce({
            id: "community_human",
            status: "published",
            og_tier: "community",
            contributor_id: "user-community",
            contributor_key: "user:user-community",
          })
          .mockResolvedValueOnce(null),
        run,
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "collection:test",
        field: "founder",
        value: "Seed founder",
        confidence: "inferred",
        verifiable: true,
        session_id: "seed-session",
        origin: "narrative_seed_agent",
      },
    })

    const res = await handleContribute(req, localMockEnv)
    const data = await res.json() as any
    expect(res.status).toBe(200)
    expect(data.status).toBe("duplicate")
    expect(data.detail).toBe("protected_human_contribution")
    expect(data.contribution_id).toBe("community_human")
    expect(run).not.toHaveBeenCalled()
  })

  it("does not overwrite divergent og-human field with seed updates", async () => {
    const run = vi.fn().mockResolvedValue({ success: true })
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce({
            id: "og_human",
            status: "published",
            og_tier: "og",
            contributor_id: "user-og",
            contributor_key: "user:user-og",
          })
          .mockResolvedValueOnce(null),
        run,
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "collection:test",
        field: "founder",
        value: "Seed founder",
        confidence: "inferred",
        verifiable: true,
        session_id: "seed-session",
        origin: "narrative_seed_agent",
      },
    })

    const res = await handleContribute(req, localMockEnv)
    const data = await res.json() as any
    expect(res.status).toBe(200)
    expect(data.status).toBe("duplicate")
    expect(data.detail).toBe("protected_human_contribution")
    expect(data.contribution_id).toBe("og_human")
    expect(run).not.toHaveBeenCalled()
  })

  it("does not overwrite divergent genesis-human field with seed updates", async () => {
    const run = vi.fn().mockResolvedValue({ success: true })
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce({
            id: "genesis_human",
            status: "published",
            og_tier: "genesis",
            contributor_id: "747550957432471654",
            contributor_key: "user:747550957432471654",
          })
          .mockResolvedValueOnce(null),
        run,
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "collection:test",
        field: "founder",
        value: "Seed founder",
        confidence: "inferred",
        verifiable: true,
        session_id: "seed-session",
        origin: "narrative_seed_agent",
      },
    })

    const res = await handleContribute(req, localMockEnv)
    const data = await res.json() as any
    expect(res.status).toBe(200)
    expect(data.status).toBe("duplicate")
    expect(data.detail).toBe("protected_human_contribution")
    expect(data.contribution_id).toBe("genesis_human")
    expect(run).not.toHaveBeenCalled()
  })

  it("does not insert seed contribution when a human quarantine contribution exists", async () => {
    const run = vi.fn().mockResolvedValue({ success: true })
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce({
            id: "quarantine_human",
            status: "quarantine",
            og_tier: "community",
            contributor_id: "user-quarantine",
            contributor_key: "user:user-quarantine",
          })
          .mockResolvedValueOnce(null),
        run,
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "collection:test",
        field: "founder",
        value: "Seed founder",
        confidence: "inferred",
        verifiable: true,
        session_id: "seed-session",
        origin: "narrative_seed_agent",
      },
    })

    const res = await handleContribute(req, localMockEnv)
    const data = await res.json() as any
    expect(res.status).toBe(200)
    expect(data.status).toBe("duplicate")
    expect(data.detail).toBe("protected_human_contribution")
    expect(data.contribution_id).toBe("quarantine_human")
    expect(run).not.toHaveBeenCalled()
  })

  it("does not apply rate limits to narrative seed agent writes", async () => {
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
      },
      CHRONICLES_KV: {
        get: vi.fn().mockResolvedValue("999"),
        put: vi.fn().mockResolvedValue(undefined),
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "collection:test",
        field: "founder",
        value: "Seed Founder No Limits",
        confidence: "inferred",
        verifiable: true,
        session_id: "seed-session",
        origin: "narrative_seed_agent",
      },
    })

    const res = await handleContribute(req, localMockEnv)
    const data = await res.json() as any
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.status).toBe("published")
    expect(data.tier_applied).toBe("genesis")
  })

  it("keeps rate limits for non-seed writes", async () => {
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
      },
      CHRONICLES_KV: {
        get: vi.fn().mockResolvedValue("999"),
        put: vi.fn().mockResolvedValue(undefined),
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "collection:test",
        field: "founder",
        value: "Human Founder",
        confidence: "stated_by_user",
        verifiable: true,
        session_id: "human-session",
      },
    })

    const res = await handleContribute(req, localMockEnv)
    const data = await res.json() as any
    expect(res.status).toBe(401)
    expect(data.ok).toBe(false)
    expect(data.error).toBe("missing_auth_token")
  })
})
