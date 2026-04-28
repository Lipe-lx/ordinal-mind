import type {
  ChatMessage,
  ChatThreadSnapshot,
  ChatThreadSummary,
  ChatWorkspaceSnapshot,
} from "./chatTypes"

const STORAGE_KEY = "ordinal-mind_narrative_chat_threads_v2"
const LEGACY_STORAGE_KEY = "ordinal-mind_narrative_chat_threads_v1"
const MAX_TURNS = 8
const MAX_MEMORY_MESSAGES = 24

interface ChatStore {
  [inscriptionId: string]: ChatWorkspaceSnapshot
}

interface LegacyThreadSnapshot {
  inscriptionId: string
  messages: ChatMessage[]
  updatedAt: string
  version: 1
}

interface LegacyStore {
  [inscriptionId: string]: LegacyThreadSnapshot
}

export function loadChatWorkspace(inscriptionId: string): ChatWorkspaceSnapshot | null {
  const store = readStore()
  const snapshot = store[inscriptionId]
  if (!snapshot || snapshot.version !== 2 || snapshot.inscriptionId !== inscriptionId) {
    return null
  }

  const threads = snapshot.threads
    .map(sanitizeThread)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  if (threads.length === 0) return null

  const activeThreadId = resolveActiveThreadId(snapshot.activeThreadId, threads)
  return {
    ...snapshot,
    activeThreadId,
    threads,
    updatedAt: newestUpdatedAt(threads),
    version: 2,
  }
}

export function ensureChatWorkspace(inscriptionId: string): ChatWorkspaceSnapshot {
  const existing = loadChatWorkspace(inscriptionId)
  if (existing) return existing

  const migrated = migrateLegacyWorkspace(inscriptionId)
  if (migrated) {
    writeWorkspace(migrated)
    return migrated
  }

  const initialThread = createThreadSnapshot(inscriptionId, {
    title: "Session 1",
    skipAutoNarrative: false,
  })

  const workspace: ChatWorkspaceSnapshot = {
    inscriptionId,
    activeThreadId: initialThread.threadId,
    threads: [initialThread],
    updatedAt: initialThread.updatedAt,
    version: 2,
  }

  writeWorkspace(workspace)
  return workspace
}

export function loadChatThread(inscriptionId: string, threadId?: string): ChatThreadSnapshot | null {
  const workspace = loadChatWorkspace(inscriptionId) ?? ensureChatWorkspace(inscriptionId)
  const targetId = threadId ?? workspace.activeThreadId
  return workspace.threads.find((thread) => thread.threadId === targetId) ?? null
}

export function saveChatThread(inscriptionId: string, messages: ChatMessage[], threadId?: string): ChatThreadSnapshot {
  const workspace = loadChatWorkspace(inscriptionId) ?? ensureChatWorkspace(inscriptionId)
  const targetThreadId = threadId ?? workspace.activeThreadId
  const now = new Date().toISOString()

  const nextThreads = workspace.threads.map((thread) => {
    if (thread.threadId !== targetThreadId) return thread
    return {
      ...thread,
      messages: truncateByTurns(messages),
      updatedAt: now,
      title: inferTitle(thread.title, messages),
    }
  })

  const activeThread = nextThreads.find((thread) => thread.threadId === targetThreadId)
  if (!activeThread) {
    const created = createThreadSnapshot(inscriptionId, {
      title: `Session ${workspace.threads.length + 1}`,
      skipAutoNarrative: true,
    })
    created.messages = truncateByTurns(messages)
    created.updatedAt = now
    created.title = inferTitle(created.title, messages)
    nextThreads.unshift(created)
    const updatedWorkspace: ChatWorkspaceSnapshot = {
      ...workspace,
      activeThreadId: created.threadId,
      threads: nextThreads,
      updatedAt: newestUpdatedAt(nextThreads),
      version: 2,
    }
    writeWorkspace(updatedWorkspace)
    return created
  }

  const updatedWorkspace: ChatWorkspaceSnapshot = {
    ...workspace,
    activeThreadId: targetThreadId,
    threads: nextThreads.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    updatedAt: newestUpdatedAt(nextThreads),
    version: 2,
  }
  writeWorkspace(updatedWorkspace)
  return activeThread
}

export function createChatThread(
  inscriptionId: string,
  options: { activate?: boolean; skipAutoNarrative?: boolean } = {}
): ChatThreadSnapshot {
  const workspace = loadChatWorkspace(inscriptionId) ?? ensureChatWorkspace(inscriptionId)
  const thread = createThreadSnapshot(inscriptionId, {
    title: `Session ${workspace.threads.length + 1}`,
    skipAutoNarrative: options.skipAutoNarrative ?? true,
  })

  const threads = [thread, ...workspace.threads]
  const updatedWorkspace: ChatWorkspaceSnapshot = {
    ...workspace,
    activeThreadId: options.activate === false ? workspace.activeThreadId : thread.threadId,
    threads,
    updatedAt: thread.updatedAt,
    version: 2,
  }
  writeWorkspace(updatedWorkspace)
  return thread
}

export function listChatThreads(inscriptionId: string): ChatThreadSummary[] {
  const workspace = loadChatWorkspace(inscriptionId) ?? ensureChatWorkspace(inscriptionId)
  return workspace.threads
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((thread) => ({
      threadId: thread.threadId,
      title: inferTitle(thread.title, thread.messages),
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messageCount: thread.messages.length,
      preview: summarizePreview(thread.messages),
    }))
}

export function activateChatThread(inscriptionId: string, threadId: string): ChatThreadSnapshot | null {
  const workspace = loadChatWorkspace(inscriptionId) ?? ensureChatWorkspace(inscriptionId)
  if (!workspace.threads.some((thread) => thread.threadId === threadId)) return null

  const updatedWorkspace: ChatWorkspaceSnapshot = {
    ...workspace,
    activeThreadId: threadId,
    updatedAt: newestUpdatedAt(workspace.threads),
    version: 2,
  }
  writeWorkspace(updatedWorkspace)
  return updatedWorkspace.threads.find((thread) => thread.threadId === threadId) ?? null
}

export function renameChatThread(
  inscriptionId: string,
  threadId: string,
  title: string
): ChatThreadSnapshot | null {
  const clean = title.trim()
  if (!clean) return null

  const workspace = loadChatWorkspace(inscriptionId) ?? ensureChatWorkspace(inscriptionId)
  let updated: ChatThreadSnapshot | null = null
  const threads = workspace.threads.map((thread) => {
    if (thread.threadId !== threadId) return thread
    updated = {
      ...thread,
      title: clean.slice(0, 120),
      updatedAt: new Date().toISOString(),
    }
    return updated
  })

  if (!updated) return null

  const updatedWorkspace: ChatWorkspaceSnapshot = {
    ...workspace,
    threads: threads.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    updatedAt: newestUpdatedAt(threads),
    version: 2,
  }
  writeWorkspace(updatedWorkspace)
  return updated
}

export function deleteChatThread(
  inscriptionId: string,
  threadId: string
): { deleted: boolean; activeThreadId: string; activeThread: ChatThreadSnapshot } {
  const workspace = loadChatWorkspace(inscriptionId) ?? ensureChatWorkspace(inscriptionId)
  const remaining = workspace.threads.filter((thread) => thread.threadId !== threadId)
  if (remaining.length === workspace.threads.length) {
    const active = workspace.threads.find((thread) => thread.threadId === workspace.activeThreadId) ?? workspace.threads[0]
    return { deleted: false, activeThreadId: active.threadId, activeThread: active }
  }

  const activeThread = (() => {
    if (remaining.length === 0) {
      return createThreadSnapshot(inscriptionId, {
        title: "Session 1",
        skipAutoNarrative: true,
      })
    }
    if (workspace.activeThreadId === threadId) {
      return remaining[0]
    }
    return remaining.find((thread) => thread.threadId === workspace.activeThreadId) ?? remaining[0]
  })()

  const nextThreads = remaining.length > 0 ? remaining : [activeThread]
  const updatedWorkspace: ChatWorkspaceSnapshot = {
    ...workspace,
    activeThreadId: activeThread.threadId,
    threads: nextThreads.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    updatedAt: newestUpdatedAt(nextThreads),
    version: 2,
  }

  writeWorkspace(updatedWorkspace)
  return {
    deleted: true,
    activeThreadId: activeThread.threadId,
    activeThread,
  }
}

export function buildCrossThreadMemory(
  inscriptionId: string,
  activeThreadId: string,
  maxMessages = MAX_MEMORY_MESSAGES
): ChatMessage[] {
  const workspace = loadChatWorkspace(inscriptionId)
  if (!workspace) return []

  const messages: ChatMessage[] = []
  for (const thread of workspace.threads) {
    if (thread.threadId === activeThreadId) continue
    // Cross-session memory should prioritize user intent/questions,
    // avoiding assistant long-form style carryover into fresh threads.
    messages.push(...thread.messages.filter((message) => message.role === "user"))
  }

  return truncateByMessageCount(messages, maxMessages)
}

function summarizePreview(messages: ChatMessage[]): string {
  const candidate = [...messages].reverse().find((message) => message.role === "user")
    ?? [...messages].reverse().find((message) => message.role === "assistant")
  if (!candidate) return "No messages yet"
  return candidate.content.slice(0, 120)
}

function inferTitle(currentTitle: string, messages: ChatMessage[]): string {
  const userMsg = messages.find((message) => message.role === "user")
  if (!userMsg) return currentTitle
  if (!currentTitle || /^Session \d+$/u.test(currentTitle)) {
    return userMsg.content.slice(0, 56)
  }
  return currentTitle
}

function createThreadSnapshot(
  inscriptionId: string,
  options: { title: string; skipAutoNarrative: boolean }
): ChatThreadSnapshot {
  const now = new Date().toISOString()
  return {
    threadId: buildId("thread"),
    inscriptionId,
    title: options.title,
    createdAt: now,
    updatedAt: now,
    skipAutoNarrative: options.skipAutoNarrative,
    messages: [],
    version: 2,
  }
}

function resolveActiveThreadId(activeThreadId: string, threads: ChatThreadSnapshot[]): string {
  if (threads.some((thread) => thread.threadId === activeThreadId)) return activeThreadId
  return threads[0].threadId
}

function newestUpdatedAt(threads: ChatThreadSnapshot[]): string {
  return threads.reduce((latest, thread) => (thread.updatedAt > latest ? thread.updatedAt : latest), threads[0]?.updatedAt ?? new Date().toISOString())
}

function sanitizeThread(thread: ChatThreadSnapshot): ChatThreadSnapshot {
  return {
    ...thread,
    messages: truncateByTurns(thread.messages),
    title: inferTitle(thread.title, thread.messages),
    skipAutoNarrative: Boolean(thread.skipAutoNarrative),
    version: 2,
  }
}

function truncateByTurns(messages: ChatMessage[]): ChatMessage[] {
  const turnIds = Array.from(new Set(messages.map((message) => message.turnId)))
  if (turnIds.length <= MAX_TURNS) return messages

  const keepTurnIds = new Set(turnIds.slice(turnIds.length - MAX_TURNS))
  return messages.filter((message) => keepTurnIds.has(message.turnId))
}

function truncateByMessageCount(messages: ChatMessage[], maxMessages: number): ChatMessage[] {
  if (messages.length <= maxMessages) return messages
  return messages.slice(messages.length - maxMessages)
}

function buildId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function migrateLegacyWorkspace(inscriptionId: string): ChatWorkspaceSnapshot | null {
  const legacyStore = readLegacyStore()
  const legacy = legacyStore[inscriptionId]
  if (!legacy || legacy.inscriptionId !== inscriptionId || legacy.version !== 1) return null

  const thread: ChatThreadSnapshot = {
    threadId: buildId("thread"),
    inscriptionId,
    title: "Session 1",
    createdAt: legacy.updatedAt,
    updatedAt: legacy.updatedAt,
    messages: truncateByTurns(legacy.messages ?? []),
    skipAutoNarrative: false,
    version: 2,
  }

  return {
    inscriptionId,
    activeThreadId: thread.threadId,
    threads: [thread],
    updatedAt: thread.updatedAt,
    version: 2,
  }
}

function readStore(): ChatStore {
  if (typeof window === "undefined") return {}

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as ChatStore
  } catch {
    return {}
  }
}

function readLegacyStore(): LegacyStore {
  if (typeof window === "undefined") return {}

  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as LegacyStore
  } catch {
    return {}
  }
}

function writeWorkspace(workspace: ChatWorkspaceSnapshot): void {
  const store = readStore()
  store[workspace.inscriptionId] = workspace
  writeStore(store)
}

function writeStore(store: ChatStore): void {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // noop
  }
}
