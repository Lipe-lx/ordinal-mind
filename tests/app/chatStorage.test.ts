import { afterEach, describe, expect, it, vi } from "vitest"
import {
  activateChatThread,
  buildCrossThreadMemory,
  createChatThread,
  deleteChatThread,
  ensureChatWorkspace,
  listChatThreads,
  loadChatThread,
  renameChatThread,
  saveChatThread,
} from "../../src/app/lib/byok/chatStorage"
import type { ChatMessage } from "../../src/app/lib/byok/chatTypes"

function message(turnId: string, role: "user" | "assistant", content: string): ChatMessage {
  return {
    id: `${turnId}_${role}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    turnId,
  }
}

function mockWindow() {
  const store = new Map<string, string>()
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    },
  })

  return store
}

describe("chatStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("persists and hydrates messages by inscription id", () => {
    mockWindow()

    saveChatThread("abc123i0", [
      message("t1", "assistant", "Opening narrative"),
      message("t2", "user", "Who owned this before?"),
      message("t2", "assistant", "The timeline shows one transfer."),
    ])

    const thread = loadChatThread("abc123i0")
    expect(thread).not.toBeNull()
    expect(thread?.messages).toHaveLength(3)
    expect(thread?.inscriptionId).toBe("abc123i0")
  })

  it("deterministically truncates oldest turns", () => {
    mockWindow()

    const messages: ChatMessage[] = []
    for (let i = 0; i < 11; i++) {
      const turnId = `turn_${i}`
      messages.push(message(turnId, "user", `question ${i}`))
      messages.push(message(turnId, "assistant", `answer ${i}`))
    }

    saveChatThread("abc123i0", messages)
    const thread = loadChatThread("abc123i0")

    expect(thread).not.toBeNull()
    expect(thread?.messages.length).toBeLessThan(messages.length)
    expect(thread?.messages[0]?.turnId).toBe("turn_3")
    expect(thread?.messages.at(-1)?.turnId).toBe("turn_10")
  })

  it("creates and switches between thread instances", () => {
    mockWindow()

    const workspace = ensureChatWorkspace("abc123i0")
    const first = loadChatThread("abc123i0", workspace.activeThreadId)
    expect(first).not.toBeNull()
    expect(first?.skipAutoNarrative).toBe(false)

    const created = createChatThread("abc123i0", { activate: true, skipAutoNarrative: true })
    expect(created.skipAutoNarrative).toBe(true)

    const active = loadChatThread("abc123i0")
    expect(active?.threadId).toBe(created.threadId)

    const switched = activateChatThread("abc123i0", first!.threadId)
    expect(switched?.threadId).toBe(first?.threadId)
  })

  it("builds cross-thread memory excluding active thread", () => {
    mockWindow()

    const workspace = ensureChatWorkspace("abc123i0")
    const firstThreadId = workspace.activeThreadId
    saveChatThread("abc123i0", [
      message("t1", "user", "first question"),
      message("t1", "assistant", "first answer"),
    ], firstThreadId)

    const second = createChatThread("abc123i0", { activate: true, skipAutoNarrative: true })
    saveChatThread("abc123i0", [
      message("t2", "user", "second question"),
      message("t2", "assistant", "second answer"),
    ], second.threadId)

    const memory = buildCrossThreadMemory("abc123i0", second.threadId, 12)
    expect(memory.some((msg) => msg.content.includes("first question"))).toBe(true)
    expect(memory.some((msg) => msg.content.includes("second question"))).toBe(false)
    expect(memory.some((msg) => msg.content.includes("first answer"))).toBe(false)
  })

  it("lists thread summaries sorted by recent activity", () => {
    mockWindow()
    ensureChatWorkspace("abc123i0")
    createChatThread("abc123i0", { activate: true, skipAutoNarrative: true })

    const history = listChatThreads("abc123i0")
    expect(history.length).toBeGreaterThanOrEqual(2)
    expect(history[0].updatedAt >= history[1].updatedAt).toBe(true)
  })

  it("renames a thread", () => {
    mockWindow()
    const workspace = ensureChatWorkspace("abc123i0")
    const thread = loadChatThread("abc123i0", workspace.activeThreadId)
    expect(thread).not.toBeNull()

    const renamed = renameChatThread("abc123i0", thread!.threadId, "Minha sessão factual")
    expect(renamed).not.toBeNull()
    expect(renamed?.title).toBe("Minha sessão factual")
  })

  it("deletes active thread and promotes another", () => {
    mockWindow()
    const workspace = ensureChatWorkspace("abc123i0")
    const firstId = workspace.activeThreadId
    const second = createChatThread("abc123i0", { activate: true, skipAutoNarrative: true })

    const result = deleteChatThread("abc123i0", second.threadId)
    expect(result.deleted).toBe(true)
    expect(result.activeThreadId).toBe(firstId)
  })
})
