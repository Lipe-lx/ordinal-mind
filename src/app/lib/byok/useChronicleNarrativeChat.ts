import { useCallback, useEffect, useRef, useState } from "react"
import { createAdapter, KeyStore } from "./index"
import { sanitizeNarrative } from "./sanitizer"
import { ToolExecutor, type ResearchLog } from "./toolExecutor"
import type { Chronicle } from "../types"
import type { SynthesisMode } from "./context"
import { useWikiLifecycle } from "./wikiLifecycle"
import { buildHybridUserMessage } from "./wikiAdapter"
import type { ChatMessage, ChatToolLog, ChatThreadSummary } from "./chatTypes"
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
} from "./chatStorage"
import { INITIAL_NARRATIVE_PROMPT } from "./prompt"
import { routeChatIntent, type ChatIntent, type ChatResponseMode } from "./chatIntentRouter"
import {
  applyResponseGuardrails,
  buildTelemetryEvent,
  getIntentRouterMode,
  resolvePolicyResponse,
} from "./chatPolicies"

export type SynthesisPhase =
  | "idle"
  | "connecting"
  | "analyzing"
  | "researching"
  | "streaming"
  | "sanitizing"
  | "done"
  | "error"

interface SendOptions {
  silentUserMessage?: boolean
  forceMode?: ChatResponseMode
  intentOverride?: ChatIntent
}

const MAX_TURNS = 8

function buildId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function truncateMessagesByTurns(messages: ChatMessage[]): ChatMessage[] {
  const turnIds = Array.from(new Set(messages.map((message) => message.turnId)))
  if (turnIds.length <= MAX_TURNS) return messages

  const keepTurnIds = new Set(turnIds.slice(turnIds.length - MAX_TURNS))
  return messages.filter((message) => keepTurnIds.has(message.turnId))
}

export function useChronicleNarrativeChat(chronicle: Chronicle | null) {
  const inscriptionId = chronicle?.meta.inscription_id ?? null
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [threadHistory, setThreadHistory] = useState<ChatThreadSummary[]>([])
  const [streamingText, setStreamingText] = useState("")
  const [phase, setPhase] = useState<SynthesisPhase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [lastInputMode, setLastInputMode] = useState<SynthesisMode | null>(null)
  const [researchLogs, setResearchLogs] = useState<ResearchLog[]>([])
  const [toolLogs, setToolLogs] = useState<ChatToolLog[]>([])
  const [wikiToolUsageCount, setWikiToolUsageCount] = useState(0)
  const [inputError, setInputError] = useState<string | null>(null)
  const wikiLifecycle = useWikiLifecycle(chronicle)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const autoTurnRef = useRef<string | null>(null)
  const lastSubmittedRef = useRef<{ prompt: string; options: SendOptions } | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (!inscriptionId) {
        setMessages([])
        setActiveThreadId(null)
        setThreadHistory([])
        setStreamingText("")
        setError(null)
        setResearchLogs([])
        setToolLogs([])
        setWikiToolUsageCount(0)
        setLastInputMode(null)
        autoTurnRef.current = null
        return
      }

      const workspace = ensureChatWorkspace(inscriptionId)
      const snapshot = loadChatThread(inscriptionId, workspace.activeThreadId)
      setActiveThreadId(workspace.activeThreadId)
      setThreadHistory(listChatThreads(inscriptionId))
      setMessages(truncateMessagesByTurns(snapshot?.messages ?? []))
      setStreamingText("")
      setError(null)
      setResearchLogs([])
      setToolLogs([])
      setWikiToolUsageCount(0)
      setLastInputMode(null)
      setPhase("idle")
      autoTurnRef.current = null
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [inscriptionId])

  useEffect(() => {
    if (!inscriptionId || !activeThreadId) return

    saveChatThread(inscriptionId, messages, activeThreadId)
    const timeoutId = window.setTimeout(() => {
      setThreadHistory(listChatThreads(inscriptionId))
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [inscriptionId, messages, activeThreadId])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    const start = Date.now()
    setElapsed(0)
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    clearTimer()
    setPhase("idle")
    setStreamingText("")
    setResearchLogs([])
    setToolLogs([])
  }, [clearTimer])

  const sendMessage = useCallback(
    async (prompt: string, options: SendOptions = {}) => {
      const trimmedPrompt = prompt.trim()
      if (!trimmedPrompt) {
        setInputError("Enter a prompt before sending.")
        return
      }

      if (!chronicle) {
        setError("Chronicle data is not available.")
        setPhase("error")
        return
      }

      const config = KeyStore.get()
      if (!config || !config.key) {
        setError("Set your API key first (BYOK button in the header)")
        setPhase("error")
        return
      }

      const adapter = createAdapter(config)
      if (!adapter) {
        setError("Invalid configuration. Check your provider and key.")
        setPhase("error")
        return
      }

      lastSubmittedRef.current = { prompt: trimmedPrompt, options }

      const turnId = buildId("turn")
      const hybridPrompt = buildHybridUserMessage(trimmedPrompt, {
        wikiPage: wikiLifecycle.wikiPage,
        wikiStatus: wikiLifecycle.status,
      })
      const userMessage: ChatMessage | null = options.silentUserMessage
        ? null
        : {
            id: buildId("user"),
            role: "user",
            content: trimmedPrompt,
            createdAt: new Date().toISOString(),
            turnId,
          }

      const history = truncateMessagesByTurns(messagesRef.current)
      const crossThreadMemory = activeThreadId
        ? buildCrossThreadMemory(chronicle.meta.inscription_id, activeThreadId)
        : []
      const modelHistory = truncateMessagesByTurns([...crossThreadMemory, ...history])
      const routerMode = getIntentRouterMode()
      const routed = routeChatIntent(trimmedPrompt, history)
      const routingActive = routerMode === "active"
      const intent = options.intentOverride ?? (routingActive ? routed.intent : "chronicle_query")
      const mode = options.forceMode ?? (routingActive ? routed.mode : "narrative")

      if (routerMode !== "off") {
        console.info("[NarrativeChat][IntentRouter]", buildTelemetryEvent(routed, trimmedPrompt))
      }

      if (userMessage) {
        setMessages((prev) => truncateMessagesByTurns([...prev, userMessage]))
      }

      setInputError(null)

      if (routingActive && !options.silentUserMessage) {
        const localPolicy = resolvePolicyResponse(intent, trimmedPrompt)
        if (localPolicy.handledLocally && localPolicy.responseText) {
          const localAssistant: ChatMessage = {
            id: buildId("assistant"),
            role: "assistant",
            content: localPolicy.responseText,
            createdAt: new Date().toISOString(),
            turnId,
          }
          setMessages((prev) => truncateMessagesByTurns([...prev, localAssistant]))
          setPhase("done")
          setStreamingText("")
          setError(null)
          setLastInputMode(null)
          setResearchLogs([])
          setToolLogs([])
          return
        }
      }

      setError(null)
      setPhase("connecting")
      setStreamingText("")
      setResearchLogs([])
      setToolLogs([])
      setLastInputMode(null)
      startTimer()

      const controller = new AbortController()
      abortRef.current = controller

      try {
        if (config.researchKeys && Object.keys(config.researchKeys).length > 0) {
          setPhase("researching")
        } else {
          setPhase("analyzing")
        }

        const toolExecutor = new ToolExecutor(config.researchKeys || {}, (log) => {
          setResearchLogs((prev) => {
            const index = prev.findIndex((entry) => entry.id === log.id)
            if (index !== -1) {
              const next = [...prev]
              next[index] = log
              return next
            }
            return [...prev, log]
          })

          setToolLogs((prev) => {
            const nextLog: ChatToolLog = { turnId, ...log }
            const index = prev.findIndex((entry) => entry.id === nextLog.id)
            if (index !== -1) {
              const next = [...prev]
              next[index] = nextLog
              return next
            }
            return [...prev, nextLog]
          })
          if (log.status !== "running" && (log.tool.startsWith("get_") || log.tool === "search_wiki")) {
            setWikiToolUsageCount((count) => count + 1)
          }
        })

        let firstChunk = true
        const result = await adapter.chatStream({
          chronicle,
          history: modelHistory,
          userMessage: hybridPrompt,
          mode,
          intent,
          onChunk: (chunk) => {
            if (firstChunk) {
              setPhase("streaming")
              firstChunk = false
            }
            setStreamingText((prev) => prev + chunk)
          },
          signal: controller.signal,
          toolExecutor,
        })

        if (controller.signal.aborted) return

        setPhase("sanitizing")
        setLastInputMode(result.inputMode)

        const clean = sanitizeNarrative(result.text)
        if (!clean) {
          setError("The AI returned an empty response. Try again or switch models.")
          setPhase("error")
          return
        }

        const previousAssistantText = [...history].reverse().find((message) => message.role === "assistant")?.content
        const guardedText = routingActive
          ? applyResponseGuardrails({
              text: clean,
              intent,
              mode,
              previousAssistantText,
              userPrompt: trimmedPrompt,
            })
          : clean

        const assistantMessage: ChatMessage = {
          id: buildId("assistant"),
          role: "assistant",
          content: guardedText,
          createdAt: new Date().toISOString(),
          turnId,
        }

        setMessages((prev) => truncateMessagesByTurns([...prev, assistantMessage]))
        setStreamingText("")
        setPhase("done")
      } catch (e) {
        if (controller.signal.aborted) return

        const message = e instanceof Error ? e.message : "Synthesis failed"
        setError(message)
        setPhase("error")
      } finally {
        clearTimer()
        abortRef.current = null
      }
    },
    [activeThreadId, chronicle, clearTimer, startTimer, wikiLifecycle.status, wikiLifecycle.wikiPage]
  )

  const retryLast = useCallback(async () => {
    if (!lastSubmittedRef.current) return
    const { prompt, options } = lastSubmittedRef.current
    await sendMessage(prompt, options)
  }, [sendMessage])

  const startNewThread = useCallback(() => {
    if (!chronicle) return
    const thread = createChatThread(chronicle.meta.inscription_id, {
      activate: true,
      skipAutoNarrative: true,
    })
    setActiveThreadId(thread.threadId)
    setMessages([])
    setStreamingText("")
    setError(null)
    setInputError(null)
    setResearchLogs([])
    setToolLogs([])
    setPhase("idle")
    setThreadHistory(listChatThreads(chronicle.meta.inscription_id))
  }, [chronicle])

  const resumeThread = useCallback((threadId: string) => {
    if (!chronicle) return
    const thread = activateChatThread(chronicle.meta.inscription_id, threadId)
    if (!thread) return
    setActiveThreadId(thread.threadId)
    setMessages(truncateMessagesByTurns(thread.messages))
    setStreamingText("")
    setError(null)
    setInputError(null)
    setResearchLogs([])
    setToolLogs([])
    setPhase("idle")
    setThreadHistory(listChatThreads(chronicle.meta.inscription_id))
  }, [chronicle])

  const renameThread = useCallback((threadId: string, nextTitle: string) => {
    if (!chronicle) return false
    const renamed = renameChatThread(chronicle.meta.inscription_id, threadId, nextTitle)
    if (!renamed) return false
    setThreadHistory(listChatThreads(chronicle.meta.inscription_id))
    return true
  }, [chronicle])

  const deleteThread = useCallback((threadId: string) => {
    if (!chronicle) return false
    const result = deleteChatThread(chronicle.meta.inscription_id, threadId)
    if (!result.deleted) return false

    setActiveThreadId(result.activeThreadId)
    setMessages(truncateMessagesByTurns(result.activeThread.messages))
    setStreamingText("")
    setError(null)
    setInputError(null)
    setResearchLogs([])
    setToolLogs([])
    setPhase("idle")
    setThreadHistory(listChatThreads(chronicle.meta.inscription_id))
    return true
  }, [chronicle])

  useEffect(() => {
    if (!chronicle || !activeThreadId) return
    if (!KeyStore.has()) return
    if (phase !== "idle") return
    if (messages.some((message) => message.role === "assistant")) return
    const activeThread = loadChatThread(chronicle.meta.inscription_id, activeThreadId)
    if (activeThread?.skipAutoNarrative) return
    const autoTurnKey = `${chronicle.meta.inscription_id}:${activeThreadId}`
    if (autoTurnRef.current === autoTurnKey) return

    autoTurnRef.current = autoTurnKey
    void sendMessage(INITIAL_NARRATIVE_PROMPT, {
      silentUserMessage: true,
      forceMode: "narrative",
      intentOverride: "chronicle_query",
    })
  }, [activeThreadId, chronicle, messages, phase, sendMessage])

  return {
    messages,
    activeThreadId,
    threadHistory,
    streamingText,
    phase,
    loading: phase !== "idle" && phase !== "done" && phase !== "error",
    error,
    inputError,
    elapsed,
    researchLogs,
    toolLogs,
    wikiPage: wikiLifecycle.wikiPage,
    wikiStatus: wikiLifecycle.status,
    wikiStatusLabel: wikiLifecycle.statusLabel,
    wikiStatusError: wikiLifecycle.lastError,
    wikiToolUsageCount,
    lastInputMode,
    sendMessage,
    startNewThread,
    resumeThread,
    renameThread,
    deleteThread,
    retryLast,
    cancel,
  }
}
