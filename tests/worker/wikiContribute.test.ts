import { describe, expect, it, vi } from "vitest"
import { handleContribute } from "../../src/worker/wiki/contribute"
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

  const createRequest = (body: any) =>
    new Request("http://localhost/api/wiki/contribute", {
      method: "POST",
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

  it("processes valid anon contribution (quarantine)", async () => {
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
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.ok).toBe(true)
    expect(data.status).toBe("quarantine")
    expect(data.tier_applied).toBe("anon")
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
      jwt: "fake-jwt",
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
        first: vi.fn().mockResolvedValue({ id: "existing", value: "Satoshi!", value_norm: "satoshi", status: "quarantine" }),
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "founder",
        value: "Satoshi",
        confidence: "stated_by_user",
        session_id: "s1",
      }
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
          status: "quarantine",
        }),
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "founder",
        value: "satoshi",
        confidence: "stated_by_user",
        session_id: "s1",
      },
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
      status: "quarantine",
    })
    const run = vi.fn().mockResolvedValue({ success: true })
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first,
        run,
      },
      JWT_SECRET: "test-secret",
    } as unknown as Env

    const req = createRequest({
      contribution: {
        collection_slug: "test-slug",
        field: "founder",
        value: "New founder",
        confidence: "correcting_existing",
        session_id: "s1",
      },
    })

    const res = await handleContribute(req, localMockEnv)
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.ok).toBe(true)
    expect(data.status).toBe("quarantine")
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

  it("updates existing published field for seed when value changes and clears consolidated cache", async () => {
    const prepare = vi.fn().mockReturnThis()
    const bind = vi.fn().mockReturnThis()
    const first = vi.fn().mockResolvedValue({
      id: "seed_update",
      value: "Old founder",
      value_norm: "old founder",
      status: "published",
      og_tier: "community",
      contributor_id: "user-1",
      contributor_key: "user:user-1",
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

  it("does not overwrite divergent genesis-human field with seed updates", async () => {
    const run = vi.fn().mockResolvedValue({ success: true })
    const localMockEnv = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          id: "genesis_human",
          value: "Human founder",
          value_norm: "human founder",
          status: "published",
          og_tier: "genesis",
          contributor_id: "747550957432471654",
          contributor_key: "user:747550957432471654",
        }),
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
    expect(data.detail).toBe("protected_genesis_human")
    expect(data.contribution_id).toBe("genesis_human")
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
    expect(res.status).toBe(429)
    expect(data.ok).toBe(false)
    expect(data.error).toBe("rate_limited")
  })
})
