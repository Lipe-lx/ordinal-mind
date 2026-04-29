export type ChatRole = "user" | "assistant"

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: string
  turnId: string
}

export type ChatTurnStatus = "idle" | "running" | "error"

export interface ChatToolLog {
  turnId: string
  id: string
  tool: string
  args: Record<string, unknown>
  status: "running" | "done" | "partial" | "error"
  result?: string
  error?: string
}

export interface ChatThreadSnapshot {
  threadId: string
  inscriptionId: string
  title: string
  createdAt: string
  messages: ChatMessage[]
  updatedAt: string
  skipAutoNarrative?: boolean
  version: 2
}

export interface ChatThreadSummary {
  threadId: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string
}

export interface ChatWorkspaceSnapshot {
  inscriptionId: string
  activeThreadId: string
  threads: ChatThreadSnapshot[]
  updatedAt: string
  version: 2
}
