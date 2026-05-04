export const SUPPORTED_LOCALES = [
  "en-US",
  "pt-BR",
  "es-ES",
  "fr-FR",
  "de-DE",
  "it-IT",
] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

const NON_ENGLISH_HINTS: Array<{ locale: SupportedLocale; patterns: RegExp[] }> = [
  {
    locale: "pt-BR",
    patterns: [
      /\b(quem|quando|como|qual|quais|nao|não|inscri[cç][aã]o|cole[cç][aã]o|fundador|criador|proveni[eê]ncia|dono|venda|vendas|mintad[ao]|cunhad[ao]|essa|dessa|nesta|hist[oó]ria)\b/u,
      /\b(transfer[eê]ncias?|comunidade|lan[cç]ou|mintou|resumo|narrativa)\b/u,
    ],
  },
  {
    locale: "es-ES",
    patterns: [
      /\b(quien|quién|cuando|como|cómo|cual|cu[aá]l|colecci[oó]n|inscripci[oó]n|fundador|creador|propietario|due[nñ]o|ventas?|historia|comunidad)\b/u,
      /\b(transferencias?|acu[nñ]ad[ao]|lanz[oó]|resumen|proveniencia|esta|esa|de esta)\b/u,
      /[¿¡]/u,
    ],
  },
  {
    locale: "fr-FR",
    patterns: [
      /\b(qui|quand|comment|quelle|quelles|fondateur|cr[eé]ateur|propri[eé]taire|ventes?|histoire|communaut[eé])\b/u,
      /\b(transferts?|frapp[eé]e|r[eé]sum[eé]|provenance|cette|dans cette)\b/u,
    ],
  },
  {
    locale: "de-DE",
    patterns: [
      /\b(wer|wann|wie|welche|welcher|sammlung|inschrift|gr[uü]nder|eigent[uü]mer|verk[aä]ufe|geschichte|gemeinschaft)\b/u,
      /\b([uü]bertragung|gepr[aä]gt|zusammenfassung|herkunft|diese|dieser)\b/u,
    ],
  },
  {
    locale: "it-IT",
    patterns: [
      /\b(chi|quando|come|quale|quali|collezione|iscrizione|fondatore|creatore|proprietario|vendite|storia|comunit[aà])\b/u,
      /\b(trasferimenti|coniat[oa]|riassunto|provenienza|questa|di questa)\b/u,
    ],
  },
]

export function detectUserLocale(input: string): SupportedLocale {
  const text = input.trim()
  if (!text) return "en-US"

  const normalized = normalizeLanguageInput(text)
  let bestLocale: SupportedLocale = "en-US"
  let bestScore = 0

  for (const rule of NON_ENGLISH_HINTS) {
    let score = 0
    for (const pattern of rule.patterns) {
      if (pattern.test(text) || pattern.test(normalized)) score += 1
    }
    if (score > bestScore) {
      bestLocale = rule.locale
      bestScore = score
    }
  }

  return bestScore >= 1 ? bestLocale : "en-US"
}

export function selectLocalized<T>(
  locale: SupportedLocale,
  variants: Partial<Record<SupportedLocale, T>> & { "en-US": T }
): T {
  return variants[locale] ?? variants["en-US"]
}

export function formatLocalizedNumber(value: number, locale: SupportedLocale): string {
  return value.toLocaleString(locale)
}

function normalizeLanguageInput(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s¿¡]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}
