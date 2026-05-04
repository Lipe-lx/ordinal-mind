import { useCallback, useEffect, useRef, useState } from "react"
import { createAdapter, KeyStore } from "./index"
import { sanitizeNarrative, sanitizeNarrativePreview } from "./sanitizer"
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
import { classifyIntentWithLlm, shouldUseLlmIntentClassifier } from "./llmIntentClassifier"
import { resolveDirectFactAnswer } from "./directFacts"
import { formatChatAnswerEnvelope, toChatAnswerEnvelope } from "./responseContract"
import { resolveChatToolPolicy } from "./toolPolicy"
import { fetchConsolidated, formatConsolidatedForPrompt } from "./wikiCompleteness"
import { parseWikiExtract, hasWikiExtract } from "./wikiExtractor"
import { detectUserLocale, selectLocalized } from "./language"

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

function buildKnowledgeContributionFallback(prompt: string): string {
  const locale = detectUserLocale(prompt)
  return selectLocalized(locale, {
    "en-US": "Understood. I'll treat that as a community wiki contribution while keeping factual verification separate from the claim shared in chat.",
    "pt-BR": "Entendi. Vou tratar isso como uma contribuição da comunidade para a wiki, mantendo a validação factual separada do relato enviado no chat.",
    "es-ES": "Entendido. Trataré eso como una contribución de la comunidad para la wiki, manteniendo la verificación factual separada de lo compartido en el chat.",
    "fr-FR": "Compris. Je traiterai cela comme une contribution communautaire à la wiki, tout en gardant la vérification factuelle séparée de ce qui a été partagé dans le chat.",
    "de-DE": "Verstanden. Ich behandle das als Community-Beitrag für das Wiki und halte die Faktenprüfung getrennt von der im Chat geteilten Behauptung.",
    "it-IT": "Capito. Tratterò questo come un contributo della community alla wiki, mantenendo la verifica fattuale separata da quanto condiviso nella chat.",
  })
}

export function resolveAssistantDisplayText(params: {
  cleanText: string
  intent: ChatIntent
  hasExtractedWiki: boolean
  prompt: string
}): string {
  if (params.cleanText.trim()) return params.cleanText
  if (params.intent === "knowledge_contribution" && params.hasExtractedWiki) {
    return buildKnowledgeContributionFallback(params.prompt)
  }
  return ""
}

async function submitWikiContribution(params: {
  data: NonNullable<ReturnType<typeof parseWikiExtract>["data"]>
  activeThreadId: string | null
  prompt: string
}): Promise<void> {
  const jwt = localStorage.getItem("ordinal-mind_discord_jwt")
  try {
    const response = await fetch("/api/wiki/contribute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contribution: {
          ...params.data,
          session_id: params.activeThreadId,
          source_excerpt: params.prompt,
        },
        jwt: jwt || undefined,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "")
      console.warn("[NarrativeChat][WikiContributionFailed]", {
        at: new Date().toISOString(),
        field: params.data.field,
        slug: params.data.collection_slug,
        status: response.status,
        body: errorBody,
      })
      return
    }

    const payload = await response.json().catch(() => ({}))
    console.info("[NarrativeChat][WikiContribution]", {
      at: new Date().toISOString(),
      field: params.data.field,
      slug: params.data.collection_slug,
      status: payload?.status,
      tier_applied: payload?.tier_applied,
    })
  } catch (error) {
    console.warn("[NarrativeChat][WikiContributionFailed]", {
      at: new Date().toISOString(),
      field: params.data.field,
      slug: params.data.collection_slug,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export interface ChronicleChatOptions {
  wikiBuilderMode?: boolean
  targetGap?: string
}

export function useChronicleNarrativeChat(chronicle: Chronicle | null, options?: ChronicleChatOptions) {
  const inscriptionId = chronicle?.meta.inscription_id ?? null
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [threadHistory, setThreadHistory] = useState<ChatThreadSummary[]>([])
  const [streamingText, setStreamingText] = useState("")
  const [streamingThought, setStreamingThought] = useState("")
  const [phase, setPhase] = useState<SynthesisPhase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [lastInputMode, setLastInputMode] = useState<SynthesisMode | null>(null)
  const [researchLogs, setResearchLogs] = useState<ResearchLog[]>([])
  const [toolLogs, setToolLogs] = useState<ChatToolLog[]>([])
  const [wikiToolUsageCount, setWikiToolUsageCount] = useState(0)
  const [inputError, setInputError] = useState<string | null>(null)
  const [wikiCompletenessInfo, setWikiCompletenessInfo] = useState<string>("")
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
        setWikiCompletenessInfo("")
        autoTurnRef.current = null
        return
      }

      const workspace = ensureChatWorkspace(inscriptionId)
      const currentSnapshot = loadChatThread(inscriptionId, workspace.activeThreadId)

      // Always start fresh if the current active thread already has messages.
      // This fulfills the requirement of starting a "new chat" on each new section.
      if (currentSnapshot && currentSnapshot.messages.length > 0) {
        const newThread = createChatThread(inscriptionId, {
          activate: true,
          skipAutoNarrative: false,
        })
        setActiveThreadId(newThread.threadId)
        setMessages([])
      } else {
        setActiveThreadId(workspace.activeThreadId)
        setMessages(truncateMessagesByTurns(currentSnapshot?.messages ?? []))
      }

      setThreadHistory(listChatThreads(inscriptionId))
      setStreamingText("")
      setError(null)
      setResearchLogs([])
      setToolLogs([])
      setWikiToolUsageCount(0)
      setLastInputMode(null)
      setPhase("idle")
      autoTurnRef.current = null

      const collectionSlug = chronicle?.collection_context.market.match?.collection_slug ?? chronicle?.collection_context.registry.match?.slug
      if (collectionSlug) {
        fetchConsolidated(collectionSlug).then(collection => {
          if (collection) setWikiCompletenessInfo(formatConsolidatedForPrompt(collection))
        }).catch(() => {})
      }
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [
    inscriptionId,
    chronicle?.collection_context.market.match?.collection_slug,
    chronicle?.collection_context.registry.match?.slug,
  ])

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
    setStreamingThought("")
    setResearchLogs([])
    setToolLogs([])
  }, [clearTimer])

  const sendMessage = useCallback(
    async (prompt: string, options: SendOptions = {}, historyOverride?: ChatMessage[]) => {
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

      const history = historyOverride ?? truncateMessagesByTurns(messagesRef.current)
      const crossThreadMemory = activeThreadId
        ? buildCrossThreadMemory(chronicle.meta.inscription_id, activeThreadId)
        : []
      const modelHistory = truncateMessagesByTurns([...crossThreadMemory, ...history])
      const routerMode = getIntentRouterMode()
      const routed = routeChatIntent(trimmedPrompt, history)
      const routingActive = routerMode === "active"
      const hasExplicitRoutingOverride = Boolean(options.intentOverride || options.forceMode)
      const llmRouted = routingActive && shouldUseLlmIntentClassifier({
        localDecision: routed,
        hasExplicitOverride: hasExplicitRoutingOverride,
        prompt: trimmedPrompt,
      })
        ? await classifyIntentWithLlm({
            config,
            prompt: trimmedPrompt,
            history,
            localDecision: routed,
          })
        : null
      const intent = options.intentOverride ?? (routingActive ? (llmRouted?.intent ?? routed.intent) : "chronicle_query")
      const mode = options.forceMode ?? (routingActive ? (llmRouted?.mode ?? routed.mode) : "narrative")
      const toolPolicyDecision = resolveChatToolPolicy({
        prompt: trimmedPrompt,
        mode,
        intent,
      })

      if (routerMode !== "off") {
        console.info("[NarrativeChat][IntentRouter]", buildTelemetryEvent(routed, trimmedPrompt))
        if (llmRouted) {
          console.info("[NarrativeChat][IntentClassifier]", {
            at: new Date().toISOString(),
            kind: "chat_intent_classifier",
            intent: llmRouted.intent,
            confidence: llmRouted.confidence,
            mode: llmRouted.mode,
            prompt_len: trimmedPrompt.length,
            fallback_intent: routed.intent,
            reason: llmRouted.reason,
          })
        }
      }

      if (userMessage) {
        if (historyOverride) {
          setMessages([...historyOverride, userMessage])
        } else {
          setMessages((prev) => truncateMessagesByTurns([...prev, userMessage]))
        }
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

      const directFact = intent === "chronicle_query" && mode === "qa"
        ? await resolveDirectFactAnswer({
            prompt: trimmedPrompt,
            chronicle,
          })
        : { handled: false as const }

      if (directFact.handled && directFact.envelope) {
        const localAssistant: ChatMessage = {
          id: buildId("assistant"),
          role: "assistant",
          content: formatChatAnswerEnvelope(directFact.envelope),
          createdAt: new Date().toISOString(),
          turnId,
        }
        console.info("[NarrativeChat][DirectFact]", {
          at: new Date().toISOString(),
          kind: "direct_fact_answer",
          provider: config.provider,
          model: config.model,
          reason: directFact.reason,
          used_tools: directFact.envelope.used_tools,
        })
        setMessages((prev) => truncateMessagesByTurns([...prev, localAssistant]))
        setPhase("done")
        setStreamingText("")
        setResearchLogs([])
        setToolLogs([])
        setError(null)
        setLastInputMode(null)
        return
      }

      setError(null)
      setPhase("connecting")
      setStreamingText("")
      setStreamingThought("")
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

        const usedToolNames = new Set<string>()
        const toolExecutor = new ToolExecutor(config.researchKeys || {}, (log) => {
          if (log.status !== "running") {
            usedToolNames.add(log.tool)
          }
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

        console.info("[NarrativeChat][TurnStart]", {
          at: new Date().toISOString(),
          kind: "chat_turn_start",
          provider: config.provider,
          model: config.model,
          intent,
          mode,
          tool_policy: toolPolicyDecision.policy,
          tool_policy_reason: toolPolicyDecision.reason,
          allowed_tools: toolPolicyDecision.allowedToolNames,
        })

        let firstChunk = true
        let accumulatedStream = ""
        const result = await adapter.chatStream({
          chronicle,
          history: modelHistory,
          userMessage: hybridPrompt,
          mode,
          intent,
          toolPolicyDecision,
          wikiCompletenessInfo,
          onChunk: (chunk) => {
            if (firstChunk) {
              setPhase("streaming")
              firstChunk = false
            }
            accumulatedStream += chunk
            
            // Real-time tag detection for streaming UI
            const thought = accumulatedStream.match(/<thought>([\s\S]*?)(?:<\/thought>|$)/i)?.[1] || ""
            const answer = accumulatedStream.match(/<final_answer>([\s\S]*?)(?:<\/final_answer>|$)/i)?.[1]
            
            if (answer !== undefined) {
              setStreamingText(sanitizeNarrativePreview(answer))
              setStreamingThought("") // Hide thought once answer starts
            } else if (thought) {
              setStreamingThought(thought)
              setStreamingText("")
            } else {
              // Fallback for models not following tags during stream
              setStreamingText(sanitizeNarrativePreview(accumulatedStream))
            }
          },
          signal: controller.signal,
          toolExecutor,
        })

        if (controller.signal.aborted) return

        setPhase("sanitizing")
        setLastInputMode(result.inputMode)

        let finalRawText = result.text
        let extractedWikiData: ReturnType<typeof parseWikiExtract>["data"] = null

        // Extract and remove <wiki_extract> block if present
        if (hasWikiExtract(finalRawText)) {
          const extracted = parseWikiExtract(finalRawText)
          finalRawText = extracted.cleanText
          extractedWikiData = extracted.data

          if (extracted.data) {
            void submitWikiContribution({
              data: extracted.data,
              activeThreadId,
              prompt: trimmedPrompt,
            })
          }
        }

        const clean = sanitizeNarrative(finalRawText)
        const safeFallback = resolveAssistantDisplayText({
          cleanText: clean,
          intent,
          hasExtractedWiki: Boolean(extractedWikiData),
          prompt: trimmedPrompt,
        })
        const envelope = toChatAnswerEnvelope({
          text: safeFallback,
          usedTools: Array.from(usedToolNames),
        })
        const displayText = formatChatAnswerEnvelope(envelope)
        if (!displayText) {
          setError("The AI returned an empty response. Try again or switch models.")
          setPhase("error")
          return
        }

        const previousAssistantText = [...history].reverse().find((message) => message.role === "assistant")?.content
        const guardedText = routingActive
          ? applyResponseGuardrails({
              text: displayText,
              intent,
              mode,
              previousAssistantText,
              userPrompt: trimmedPrompt,
            })
          : displayText

        console.info("[NarrativeChat][TurnEnd]", {
          at: new Date().toISOString(),
          kind: "chat_turn_end",
          provider: config.provider,
          model: config.model,
          intent,
          mode,
          tool_policy: toolPolicyDecision.policy,
          used_tools: envelope.used_tools,
          input_mode: result.inputMode,
        })

        const assistantMessage: ChatMessage = {
          id: buildId("assistant"),
          role: "assistant",
          content: guardedText,
          thought: accumulatedStream.match(/<thought>([\s\S]*?)<\/thought>/i)?.[1],
          createdAt: new Date().toISOString(),
          turnId,
        }

        setMessages((prev) => truncateMessagesByTurns([...prev, assistantMessage]))
        setStreamingText("")
        setStreamingThought("")
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
    [
      activeThreadId,
      chronicle,
      clearTimer,
      startTimer,
      wikiLifecycle.status,
      wikiLifecycle.wikiPage,
      wikiCompletenessInfo,
    ]
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

  const editMessage = useCallback(
    async (messageId: string, nextContent: string) => {
      const index = messagesRef.current.findIndex((m) => m.id === messageId)
      if (index === -1) return

      // Cancel any current generation
      cancel()

      // Truncate messages after the one being edited
      const truncated = messagesRef.current.slice(0, index)
      
      // Send the new content with truncated history
      await sendMessage(nextContent, {}, truncated)
    },
    [cancel, sendMessage]
  )

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

    const isBuilder = options?.wikiBuilderMode && options?.targetGap
    const initialPrompt = isBuilder
      ? `[SYSTEM] Enter Wiki Builder mode. Introduce yourself briefly and ask the user if they have information about the missing collection field: ${options.targetGap}. Keep it conversational.`
      : INITIAL_NARRATIVE_PROMPT

    void sendMessage(initialPrompt, {
      silentUserMessage: true,
      forceMode: isBuilder ? "qa" : "narrative",
      intentOverride: isBuilder ? "knowledge_contribution" : "chronicle_query",
    })
  }, [activeThreadId, chronicle, messages, phase, sendMessage, options?.wikiBuilderMode, options?.targetGap])

  return {
    messages,
    activeThreadId,
    threadHistory,
    streamingText,
    streamingThought,
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
    editMessage,
    retryLast,
    cancel,
  }
}
