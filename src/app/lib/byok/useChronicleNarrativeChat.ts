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
import { submitWikiContribution } from "./wikiSubmit"
import { runWikiSeedAgent } from "./wikiSeedAgent"

export type SynthesisPhase =
  | "idle"
  | "connecting"
  | "analyzing"
  | "researching"
  | "streaming"
  | "sanitizing"
  | "done"
  | "error"

export type WikiActivityState = "idle" | "reading" | "writing" | "partial" | "success" | "error"

export interface WikiActivityStatus {
  state: WikiActivityState
  label: string
}

interface SendOptions {
  silentUserMessage?: boolean
  forceMode?: ChatResponseMode
  intentOverride?: ChatIntent
}

const MAX_TURNS = 8

function buildId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function buildWikiSeedFingerprint(inscriptionId: string, narrative: string): string {
  const normalized = narrative
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 4000)
  return `${inscriptionId}:${normalized}`
}

export function shouldCreateFreshAutoNarrativeThread(currentSnapshot: {
  messages: Array<unknown>
  skipAutoNarrative?: boolean
} | null): boolean {
  if (!currentSnapshot) return false
  if (currentSnapshot.messages.length > 0) return true
  return Boolean(currentSnapshot.skipAutoNarrative)
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

const WIKI_TOOL_ACTIVITY_LABELS: Record<string, {
  running: string
  done: string
  partial: string
  error: string
}> = {
  search_wiki: {
    running: "Searching saved wiki context...",
    done: "Wiki context loaded for this reply.",
    partial: "Wiki context came back partial.",
    error: "Wiki context lookup failed.",
  },
  get_collection_context: {
    running: "Loading collection context from the wiki...",
    done: "Collection context loaded from the wiki.",
    partial: "Collection context is only partially available.",
    error: "Collection context could not be loaded.",
  },
  get_timeline: {
    running: "Collecting factual timeline rows...",
    done: "Timeline rows collected from public records.",
    partial: "Timeline rows came back partial.",
    error: "Timeline lookup failed.",
  },
  get_raw_events: {
    running: "Collecting raw public event rows...",
    done: "Raw public event rows collected.",
    partial: "Raw event collection is incomplete.",
    error: "Raw event collection failed.",
  },
}

export function resolveWikiToolActivityStatus(log: Pick<ResearchLog, "tool" | "status">): WikiActivityStatus | null {
  const labels = WIKI_TOOL_ACTIVITY_LABELS[log.tool]
  if (!labels) return null

  const state: WikiActivityState =
    log.status === "running"
      ? "reading"
      : log.status === "done"
        ? "success"
        : log.status === "partial"
          ? "partial"
          : "error"

  return {
    state,
    label: labels[log.status],
  }
}

function formatWikiFieldLabel(field: string): string {
  return field.replace(/_/g, " ")
}

export function resolveWikiContributionActivityStatus(params: {
  phase: "running" | "done" | "error"
  field: string
  operation?: "add" | "delete"
}): WikiActivityStatus {
  const isDelete = params.operation === "delete"
  if (params.phase === "running") {
    return {
      state: "writing",
      label: isDelete 
        ? `Deleting wiki field ${formatWikiFieldLabel(params.field)}...`
        : `Saving wiki contribution for ${formatWikiFieldLabel(params.field)}...`,
    }
  }

  if (params.phase === "done") {
    return {
      state: "success",
      label: isDelete
        ? `Wiki field ${formatWikiFieldLabel(params.field)} was deleted.`
        : `Wiki contribution for ${formatWikiFieldLabel(params.field)} was recorded.`,
    }
  }

  return {
    state: "error",
    label: isDelete
      ? `Wiki field ${formatWikiFieldLabel(params.field)} could not be deleted.`
      : `Wiki contribution for ${formatWikiFieldLabel(params.field)} could not be recorded.`,
  }
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
  const [wikiActivity, setWikiActivity] = useState<WikiActivityStatus | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [wikiCompletenessInfo, setWikiCompletenessInfo] = useState<string>("")
  const [wikiCompletenessStatus, setWikiCompletenessStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle")
  const wikiLifecycle = useWikiLifecycle(chronicle)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const autoTurnRef = useRef<string | null>(null)
  const lastSubmittedRef = useRef<{ prompt: string; options: SendOptions } | null>(null)
  const lastWikiSeedFingerprintRef = useRef<string | null>(null)

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
        setWikiActivity(null)
        setLastInputMode(null)
        setWikiCompletenessInfo("")
        autoTurnRef.current = null
        lastWikiSeedFingerprintRef.current = null
        return
      }

      const workspace = ensureChatWorkspace(inscriptionId)
      const currentSnapshot = loadChatThread(inscriptionId, workspace.activeThreadId)

      // Always start fresh if the current active thread already has messages.
      // This fulfills the requirement of starting a "new chat" on each new section.
      if (shouldCreateFreshAutoNarrativeThread(currentSnapshot)) {
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
      setWikiActivity(null)
      setLastInputMode(null)
      setPhase("idle")
      autoTurnRef.current = null

      const collectionSlug = chronicle?.collection_context.market.match?.collection_slug ?? chronicle?.collection_context.registry.match?.slug
      const targetInscriptionId = chronicle?.meta.inscription_id

      if (collectionSlug || targetInscriptionId) {
        setWikiCompletenessStatus("loading")
        
        Promise.all([
          collectionSlug ? fetchConsolidated(collectionSlug) : Promise.resolve(null),
          targetInscriptionId ? fetchConsolidated(targetInscriptionId) : Promise.resolve(null)
        ]).then(([collection, inscription]) => {
          let mergedInfo = ""
          if (collection) {
            mergedInfo += `[Consolidated Collection Knowledge]\n${formatConsolidatedForPrompt(collection)}\n\n`
          }
          if (inscription) {
            mergedInfo += `[Consolidated Inscription Knowledge]\n${formatConsolidatedForPrompt(inscription)}\n`
          }
          
          setWikiCompletenessInfo(mergedInfo.trim())
          setWikiCompletenessStatus("loaded")
        }).catch(() => {
          setWikiCompletenessStatus("error")
        })
      } else {
        setWikiCompletenessStatus("loaded") 
      }
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [
    inscriptionId,
    chronicle?.meta.inscription_id,
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
    setWikiActivity(null)
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
      setWikiActivity(null)

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
      setWikiActivity(wikiLifecycle.wikiPage
        ? {
            state: "reading",
            label: `Using loaded wiki context from ${wikiLifecycle.wikiPage.title}.`,
          }
        : null)
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
          const wikiToolActivity = resolveWikiToolActivityStatus(log)
          if (wikiToolActivity) {
            setWikiActivity(wikiToolActivity)
          }
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
          wikiPage: wikiLifecycle.wikiPage,
          wikiStatus: wikiLifecycle.status,
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
            setWikiActivity(resolveWikiContributionActivityStatus({
              phase: "running",
              field: extracted.data.field,
              operation: extracted.data.operation,
            }))
            void submitWikiContribution({
              data: extracted.data,
              activeThreadId,
              prompt: trimmedPrompt,
            }).then((submission) => {
              setWikiActivity(resolveWikiContributionActivityStatus({
                phase: submission.ok ? "done" : "error",
                field: extracted.data?.field ?? "contribution",
                operation: extracted.data?.operation,
              }))
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

        // --- Wiki Seed Agent ---
        // Runs on every finalized narrative response, with local fingerprint dedupe so
        // repeated identical narratives are not re-processed.
        if (mode === "narrative" && clean.trim() && chronicle?.meta.inscription_id) {
          const fingerprint = buildWikiSeedFingerprint(chronicle.meta.inscription_id, clean)
          if (lastWikiSeedFingerprintRef.current !== fingerprint) {
            lastWikiSeedFingerprintRef.current = fingerprint
            const seedConfig = KeyStore.get()
            if (seedConfig?.key && chronicle) {
              void runWikiSeedAgent({
                narrative: clean,
                chronicle,
                config: seedConfig,
                sessionId: activeThreadId,
                onProgress: (status) => {
                  setWikiActivity({
                    state:
                      status.state === "done" ? "success"
                      : status.state === "error" ? "error"
                      : "writing",
                    label: status.label,
                  })
                },
              })
            }
          } else {
            console.info("[NarrativeChat][WikiSeed] Skipping repeated narrative fingerprint", {
              at: new Date().toISOString(),
              inscription_id: chronicle.meta.inscription_id,
            })
          }
        }
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
    setWikiActivity(null)
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
    setWikiActivity(null)
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
    setWikiActivity(null)
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

    // Pillar 2 - Race Condition Protection:
    // If a collection context is expected, wait for it to load before sending the initial narrative.
    // This ensures that collection-level knowledge (founders, origin story) is injected into the prompt.
    const collectionSlug = chronicle?.collection_context.market.match?.collection_slug ?? chronicle?.collection_context.registry.match?.slug
    if (collectionSlug && wikiCompletenessStatus !== "loaded" && wikiCompletenessStatus !== "error") return

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
  }, [activeThreadId, chronicle, messages, phase, sendMessage, options?.wikiBuilderMode, options?.targetGap, wikiCompletenessStatus])

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
    wikiActivity,
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
