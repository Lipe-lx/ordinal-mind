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
        first: vi.fn().mockResolvedValue({ id: "existing" }),
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
})
