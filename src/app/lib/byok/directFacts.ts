import type { Chronicle } from "../types"
import { executeWikiTool } from "./wikiAdapter"
import type { ChatAnswerEnvelope } from "./responseContract"
import { detectUserLocale, formatLocalizedNumber, selectLocalized, type SupportedLocale } from "./language"

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
  const locale = detectUserLocale(params.prompt)

  if (isCollectionSizeQuestion(normalized)) {
    return resolveCollectionSizeAnswer(params.chronicle, locale)
  }

  if (isOwnerQuestion(normalized)) {
    const address = params.chronicle.meta.owner_address
    if (!address) return { handled: false }

    return {
      handled: true,
      reason: "current_owner_from_chronicle",
      envelope: {
        answer: selectLocalized(locale, {
          "en-US": `The current owner recorded in the Chronicle is ${address}.`,
          "pt-BR": `O owner atual registrado no Chronicle é ${address}.`,
          "es-ES": `El owner actual registrado en la Chronicle es ${address}.`,
          "fr-FR": `Le propriétaire actuel enregistré dans la Chronicle est ${address}.`,
          "de-DE": `Der aktuell in der Chronicle verzeichnete Eigentümer ist ${address}.`,
          "it-IT": `L'owner attuale registrato nella Chronicle è ${address}.`,
        }),
        evidence: selectLocalized(locale, {
          "en-US": "This comes from the Chronicle field for the current owner of this inscription.",
          "pt-BR": "Isso vem do campo de owner atual no Chronicle desta inscrição.",
          "es-ES": "Esto proviene del campo de owner actual de esta inscripción en la Chronicle.",
          "fr-FR": "Cela vient du champ de propriétaire actuel de cette inscription dans la Chronicle.",
          "de-DE": "Das stammt aus dem Chronicle-Feld für den aktuellen Eigentümer dieser Inschrift.",
          "it-IT": "Questo proviene dal campo dell'owner attuale di questa iscrizione nella Chronicle.",
        }),
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
        answer: selectLocalized(locale, {
          "en-US": `The inscription was minted on ${genesisTimestamp}.`,
          "pt-BR": `A inscrição foi cunhada em ${genesisTimestamp}.`,
          "es-ES": `La inscripción fue acuñada el ${genesisTimestamp}.`,
          "fr-FR": `L'inscription a été frappée le ${genesisTimestamp}.`,
          "de-DE": `Die Inschrift wurde am ${genesisTimestamp} geprägt.`,
          "it-IT": `L'iscrizione è stata coniata il ${genesisTimestamp}.`,
        }),
        evidence: selectLocalized(locale, {
          "en-US": `The Chronicle records this at block ${formatLocalizedNumber(genesisBlock, locale)}.`,
          "pt-BR": `O Chronicle registra isso no bloco ${formatLocalizedNumber(genesisBlock, locale)}.`,
          "es-ES": `La Chronicle registra esto en el bloque ${formatLocalizedNumber(genesisBlock, locale)}.`,
          "fr-FR": `La Chronicle enregistre cela au bloc ${formatLocalizedNumber(genesisBlock, locale)}.`,
          "de-DE": `Die Chronicle verzeichnet dies im Block ${formatLocalizedNumber(genesisBlock, locale)}.`,
          "it-IT": `La Chronicle registra questo al blocco ${formatLocalizedNumber(genesisBlock, locale)}.`,
        }),
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
          answer: selectLocalized(locale, {
            "en-US": "I could not find a confirmed parent inscription in the current Chronicle data.",
            "pt-BR": "Não encontrei uma inscrição parent confirmada nos dados atuais do Chronicle.",
            "es-ES": "No pude encontrar una inscripción parent confirmada en los datos actuales de la Chronicle.",
            "fr-FR": "Je n'ai pas trouvé d'inscription parent confirmée dans les données actuelles de la Chronicle.",
            "de-DE": "Ich konnte in den aktuellen Chronicle-Daten keine bestätigte Parent-Inschrift finden.",
            "it-IT": "Non sono riuscito a trovare una parent inscription confermata nei dati attuali della Chronicle.",
          }),
          used_tools: [],
        },
      }
    }

    return {
      handled: true,
      reason: "parent_from_chronicle",
      envelope: {
        answer: selectLocalized(locale, {
          "en-US": `The recorded parent inscription is ${parentId}.`,
          "pt-BR": `A parent inscription registrada é ${parentId}.`,
          "es-ES": `La parent inscription registrada es ${parentId}.`,
          "fr-FR": `La parent inscription enregistrée est ${parentId}.`,
          "de-DE": `Die verzeichnete Parent-Inschrift ist ${parentId}.`,
          "it-IT": `La parent inscription registrata è ${parentId}.`,
        }),
        evidence: selectLocalized(locale, {
          "en-US": "This comes from the collection relations already present in the Chronicle.",
          "pt-BR": "Isso vem das relações de coleção já presentes no Chronicle.",
          "es-ES": "Esto proviene de las relaciones de colección ya presentes en la Chronicle.",
          "fr-FR": "Cela provient des relations de collection déjà présentes dans la Chronicle.",
          "de-DE": "Das stammt aus den bereits in der Chronicle vorhandenen Sammlungsbeziehungen.",
          "it-IT": "Questo proviene dalle relazioni di collezione già presenti nella Chronicle.",
        }),
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
        answer: selectLocalized(locale, {
          "en-US": `I found ${formatLocalizedNumber(transferCount, locale)} transfer or sale events in the current Chronicle.`,
          "pt-BR": `Encontrei ${formatLocalizedNumber(transferCount, locale)} eventos de transferência ou venda no Chronicle atual.`,
          "es-ES": `Encontré ${formatLocalizedNumber(transferCount, locale)} eventos de transferencia o venta en la Chronicle actual.`,
          "fr-FR": `J'ai trouvé ${formatLocalizedNumber(transferCount, locale)} événements de transfert ou de vente dans la Chronicle actuelle.`,
          "de-DE": `Ich habe ${formatLocalizedNumber(transferCount, locale)} Transfer- oder Verkaufsevents in der aktuellen Chronicle gefunden.`,
          "it-IT": `Ho trovato ${formatLocalizedNumber(transferCount, locale)} eventi di trasferimento o vendita nella Chronicle attuale.`,
        }),
        evidence: selectLocalized(locale, {
          "en-US": "The count comes from the factual timeline already loaded.",
          "pt-BR": "A contagem foi feita a partir da timeline factual já carregada.",
          "es-ES": "El conteo proviene de la timeline factual ya cargada.",
          "fr-FR": "Le comptage provient de la timeline factuelle déjà chargée.",
          "de-DE": "Die Zählung stammt aus der bereits geladenen faktischen Timeline.",
          "it-IT": "Il conteggio proviene dalla timeline fattuale già caricata.",
        }),
        used_tools: [],
      },
    }
  }

  return { handled: false }
}

async function resolveCollectionSizeAnswer(
  chronicle: Chronicle,
  locale: SupportedLocale
): Promise<DirectFactResolution> {
  const collectionSlug = chronicle.collection_context.market.match?.collection_slug
    ?? chronicle.collection_context.registry.match?.slug
  const collectionName = chronicle.collection_context.presentation.full_label
    ?? chronicle.collection_context.presentation.item_label
    ?? chronicle.collection_context.presentation.primary_label
    ?? chronicle.collection_context.market.match?.collection_name
    ?? chronicle.collection_context.registry.match?.matched_collection
    ?? selectLocalized(locale, {
      "en-US": "this collection",
      "pt-BR": "esta coleção",
      "es-ES": "esta colección",
      "fr-FR": "cette collection",
      "de-DE": "diese Sammlung",
      "it-IT": "questa collezione",
    })

  if (collectionSlug) {
    const payload = await executeWikiTool("get_collection_context", { collection_slug: collectionSlug })
    const exactCount = readNumber(payload.collection_size)
      ?? readNumber((payload.stats as Record<string, unknown> | undefined)?.count)

    if (exactCount != null) {
      return {
        handled: true,
        reason: "collection_size_from_wiki_tool",
        envelope: {
          answer: selectLocalized(locale, {
            "en-US": `I found ${formatLocalizedNumber(exactCount, locale)} inscriptions mapped to the ${collectionName} collection.`,
            "pt-BR": `Encontrei ${formatLocalizedNumber(exactCount, locale)} inscrições mapeadas para a coleção ${collectionName}.`,
            "es-ES": `Encontré ${formatLocalizedNumber(exactCount, locale)} inscripciones asociadas a la colección ${collectionName}.`,
            "fr-FR": `J'ai trouvé ${formatLocalizedNumber(exactCount, locale)} inscriptions associées à la collection ${collectionName}.`,
            "de-DE": `Ich habe ${formatLocalizedNumber(exactCount, locale)} Inschriften gefunden, die der Sammlung ${collectionName} zugeordnet sind.`,
            "it-IT": `Ho trovato ${formatLocalizedNumber(exactCount, locale)} iscrizioni associate alla collezione ${collectionName}.`,
          }),
          evidence: selectLocalized(locale, {
            "en-US": "That total came from `get_collection_context`, based on indexed public genesis events.",
            "pt-BR": "Esse total veio de `get_collection_context`, baseado nos eventos públicos de genesis indexados.",
            "es-ES": "Ese total provino de `get_collection_context`, basado en eventos públicos de genesis ya indexados.",
            "fr-FR": "Ce total provient de `get_collection_context`, basé sur des événements publics de genesis déjà indexés.",
            "de-DE": "Diese Gesamtzahl stammt aus `get_collection_context` und basiert auf indexierten öffentlichen Genesis-Ereignissen.",
            "it-IT": "Questo totale proviene da `get_collection_context`, basato su eventi pubblici di genesis già indicizzati.",
          }),
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
        answer: selectLocalized(locale, {
          "en-US": `Public collection data for ${collectionName} shows a supply of ${publicSupply}.`,
          "pt-BR": `Os dados públicos da coleção ${collectionName} mostram supply de ${publicSupply}.`,
          "es-ES": `Los datos públicos de la colección ${collectionName} muestran un supply de ${publicSupply}.`,
          "fr-FR": `Les données publiques de la collection ${collectionName} indiquent un supply de ${publicSupply}.`,
          "de-DE": `Die öffentlichen Sammlungsdaten für ${collectionName} zeigen ein Supply von ${publicSupply}.`,
          "it-IT": `I dati pubblici della collezione ${collectionName} mostrano un supply di ${publicSupply}.`,
        }),
        uncertainty: selectLocalized(locale, {
          "en-US": "That is a public collection-page supply figure and may not match an exact on-chain count.",
          "pt-BR": "Isso é um supply público de página de coleção e pode não corresponder a uma contagem on-chain exata.",
          "es-ES": "Ese es un valor público de supply de una página de colección y puede no coincidir con un conteo exacto on-chain.",
          "fr-FR": "Il s'agit d'une valeur publique de supply issue d'une page de collection et elle peut ne pas correspondre à un comptage on-chain exact.",
          "de-DE": "Das ist ein öffentlicher Supply-Wert von einer Sammlungsseite und entspricht möglicherweise nicht einer exakten On-Chain-Zählung.",
          "it-IT": "Si tratta di un valore pubblico di supply di una pagina di collezione e potrebbe non corrispondere a un conteggio on-chain esatto.",
        }),
        used_tools: [],
      },
    }
  }

  return {
    handled: true,
    reason: "collection_size_unavailable",
    envelope: {
      answer: selectLocalized(locale, {
        "en-US": `I could not confirm an exact count for ${collectionName} from the public data currently available.`,
        "pt-BR": `Não consegui confirmar uma contagem exata para ${collectionName} com os dados públicos disponíveis agora.`,
        "es-ES": `No pude confirmar un conteo exacto para ${collectionName} con los datos públicos disponibles en este momento.`,
        "fr-FR": `Je n'ai pas pu confirmer un comptage exact pour ${collectionName} à partir des données publiques actuellement disponibles.`,
        "de-DE": `Ich konnte mit den derzeit verfügbaren öffentlichen Daten keine exakte Anzahl für ${collectionName} bestätigen.`,
        "it-IT": `Non sono riuscito a confermare un conteggio esatto per ${collectionName} con i dati pubblici attualmente disponibili.`,
      }),
      uncertainty: selectLocalized(locale, {
        "en-US": "The current data does not provide a reliable enough total to state that number without extrapolating.",
        "pt-BR": "Os dados atuais não trazem um total confiável o suficiente para afirmar esse número sem extrapolar.",
        "es-ES": "Los datos actuales no ofrecen un total lo bastante confiable como para afirmar ese número sin extrapolar.",
        "fr-FR": "Les données actuelles ne fournissent pas un total suffisamment fiable pour affirmer ce nombre sans extrapolation.",
        "de-DE": "Die aktuellen Daten liefern keine ausreichend verlässliche Gesamtzahl, um diese Zahl ohne Extrapolation zu nennen.",
        "it-IT": "I dati attuali non forniscono un totale abbastanza affidabile da affermare quel numero senza estrapolare.",
      }),
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
