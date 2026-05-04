import type { Chronicle } from "../types"
import { executeWikiTool } from "./wikiAdapter"
import type { ChatAnswerEnvelope } from "./responseContract"

export interface DirectFactResolution {
  handled: boolean
  envelope?: ChatAnswerEnvelope
  reason?: string
}

export async function resolveDirectFactAnswer(params: {
  prompt: string
  chronicle: Chronicle
}): Promise<DirectFactResolution> {
  const normalized = normalize(params.prompt)
  const isNonEnglish = detectNonEnglish(normalized)

  if (isCollectionSizeQuestion(normalized)) {
    return resolveCollectionSizeAnswer(params.chronicle, isNonEnglish)
  }

  if (isOwnerQuestion(normalized)) {
    const address = params.chronicle.meta.owner_address
    if (!address) return { handled: false }

    return {
      handled: true,
      reason: "current_owner_from_chronicle",
      envelope: {
        answer: isNonEnglish
          ? `O owner atual registrado no Chronicle é ${address}.`
          : `The current owner recorded in the Chronicle is ${address}.`,
        evidence: isNonEnglish
          ? `Isso vem do campo de owner atual no Chronicle desta inscrição.`
          : `This comes from the Chronicle field for the current owner of this inscription.`,
        used_tools: [],
      },
    }
  }

  if (isGenesisQuestion(normalized)) {
    const { genesis_timestamp: genesisTimestamp, genesis_block: genesisBlock } = params.chronicle.meta
    if (!genesisTimestamp) return { handled: false }

    return {
      handled: true,
      reason: "genesis_from_chronicle",
      envelope: {
        answer: isNonEnglish
          ? `A inscrição foi cunhada em ${genesisTimestamp}.`
          : `The inscription was minted on ${genesisTimestamp}.`,
        evidence: isNonEnglish
          ? `O Chronicle registra isso no bloco ${genesisBlock.toLocaleString("en-US")}.`
          : `The Chronicle records this at block ${genesisBlock.toLocaleString("en-US")}.`,
        used_tools: [],
      },
    }
  }

  if (isParentQuestion(normalized)) {
    const parentId = params.chronicle.meta.collection?.parent_inscription_id
      ?? params.chronicle.collection_context.protocol.parents?.items[0]?.inscription_id

    if (!parentId) {
      return {
        handled: true,
        reason: "parent_missing_in_chronicle",
        envelope: {
          answer: isNonEnglish
            ? "Não encontrei uma inscrição parent confirmada nos dados atuais do Chronicle."
            : "I could not find a confirmed parent inscription in the current Chronicle data.",
          used_tools: [],
        },
      }
    }

    return {
      handled: true,
      reason: "parent_from_chronicle",
      envelope: {
        answer: isNonEnglish
          ? `A parent inscription registrada é ${parentId}.`
          : `The recorded parent inscription is ${parentId}.`,
        evidence: isNonEnglish
          ? "Isso vem das relações de coleção já presentes no Chronicle."
          : "This comes from the collection relations already present in the Chronicle.",
        used_tools: [],
      },
    }
  }

  if (isTransferCountQuestion(normalized)) {
    const transferCount = params.chronicle.events.filter((event) => event.event_type === "transfer" || event.event_type === "sale").length
    return {
      handled: true,
      reason: "transfer_count_from_chronicle",
      envelope: {
        answer: isNonEnglish
          ? `Encontrei ${transferCount.toLocaleString("en-US")} eventos de transferência ou venda no Chronicle atual.`
          : `I found ${transferCount.toLocaleString("en-US")} transfer or sale events in the current Chronicle.`,
        evidence: isNonEnglish
          ? "A contagem foi feita a partir da timeline factual já carregada."
          : "The count comes from the factual timeline already loaded.",
        used_tools: [],
      },
    }
  }

  return { handled: false }
}

async function resolveCollectionSizeAnswer(chronicle: Chronicle, isNonEnglish: boolean): Promise<DirectFactResolution> {
  const collectionSlug = chronicle.collection_context.market.match?.collection_slug
    ?? chronicle.collection_context.registry.match?.slug
  const collectionName = chronicle.collection_context.presentation.full_label
    ?? chronicle.collection_context.presentation.item_label
    ?? chronicle.collection_context.presentation.primary_label
    ?? chronicle.collection_context.market.match?.collection_name
    ?? chronicle.collection_context.registry.match?.matched_collection
    ?? "this collection"

  if (collectionSlug) {
    const payload = await executeWikiTool("get_collection_context", { collection_slug: collectionSlug })
    const exactCount = readNumber(payload.collection_size)
      ?? readNumber((payload.stats as Record<string, unknown> | undefined)?.count)

    if (exactCount != null) {
      return {
        handled: true,
        reason: "collection_size_from_wiki_tool",
        envelope: {
          answer: isNonEnglish
            ? `Encontrei ${exactCount.toLocaleString("en-US")} inscrições mapeadas para a coleção ${collectionName}.`
            : `I found ${exactCount.toLocaleString("en-US")} inscriptions mapped to the ${collectionName} collection.`,
          evidence: isNonEnglish
            ? "Esse total veio de `get_collection_context`, baseado nos eventos públicos de genesis indexados."
            : "That total came from `get_collection_context`, based on indexed public genesis events.",
          used_tools: ["get_collection_context"],
        },
      }
    }
  }

  const publicSupply = chronicle.collection_context.profile?.market_stats?.supply
  if (publicSupply) {
    return {
      handled: true,
      reason: "collection_supply_from_market_profile",
      envelope: {
        answer: isNonEnglish
          ? `Os dados públicos da coleção ${collectionName} mostram supply de ${publicSupply}.`
          : `Public collection data for ${collectionName} shows a supply of ${publicSupply}.`,
        uncertainty: isNonEnglish
          ? "Isso é um supply público de página de coleção e pode não corresponder a uma contagem on-chain exata."
          : "That is a public collection-page supply figure and may not match an exact on-chain count.",
        used_tools: [],
      },
    }
  }

  return {
    handled: true,
    reason: "collection_size_unavailable",
    envelope: {
      answer: isNonEnglish
        ? `Não consegui confirmar uma contagem exata para ${collectionName} com os dados públicos disponíveis agora.`
        : `I could not confirm an exact count for ${collectionName} from the public data currently available.`,
      uncertainty: isNonEnglish
        ? "Os dados atuais não trazem um total confiável o suficiente para afirmar esse número sem extrapolar."
        : "The current data does not provide a reliable enough total to state that number without extrapolating.",
      used_tools: collectionSlug ? ["get_collection_context"] : [],
    },
  }
}

function isCollectionSizeQuestion(prompt: string): boolean {
  return (
    /\b(how many|quant[ao]s?|supply|total)\b/u.test(prompt) &&
    /\b(collection|colecao|colec[aã]o|items?|inscriptions?|inscricoes?)\b/u.test(prompt) &&
    !/\brunestone\b/u.test(prompt)
  )
}

function isOwnerQuestion(prompt: string): boolean {
  return /\b(owner|dono|proprietario|proprietário|holder|wallet atual)\b/u.test(prompt)
}

function isGenesisQuestion(prompt: string): boolean {
  return /\b(genesis|mint|minted|mintada|mintado|cunhad[ao]|quando nasceu|when was it minted)\b/u.test(prompt)
}

function isParentQuestion(prompt: string): boolean {
  return /\b(parent|pai|inscricao pai|inscrição pai)\b/u.test(prompt)
}

function isTransferCountQuestion(prompt: string): boolean {
  return (
    /\b(how many|quant[ao]s?|count|numero|n[uú]mero)\b/u.test(prompt) &&
    /\b(transfers?|transferencias|transferências|sales?|vendas?)\b/u.test(prompt)
  )
}

function detectNonEnglish(prompt: string): boolean {
  return /\b(quant[ao]s?|colecao|colec[aã]o|inscri[cç][aã]o|dono|cunhad[ao]|vendas?)\b/u.test(prompt)
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}
