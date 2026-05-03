import React, { ReactNode, isValidElement, cloneElement } from "react"

export function formatChronicleText(node: ReactNode, collectionSlug?: string): ReactNode {
  if (typeof node === "string") {
    return formatString(node, collectionSlug)
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <React.Fragment key={i}>{formatChronicleText(child, collectionSlug)}</React.Fragment>
    ))
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    if (props && props.children) {
      // Avoid formatting inside certain elements if necessary, like code blocks
      if (node.type === "code" || node.type === "pre") {
        return node;
      }
      return cloneElement(node, {
        ...props,
        children: formatChronicleText(props.children, collectionSlug),
      } as Record<string, unknown>);
    }
  }
  return node
}

function formatString(text: string, collectionSlug?: string): ReactNode {
  if (!text) return text

  const brands = [
    { name: "Satflow", url: collectionSlug ? `https://www.satflow.com/ordinals/${collectionSlug}` : "https://www.satflow.com/" },
    { name: "ord.net", url: collectionSlug ? `https://ord.net/collection/${collectionSlug}` : "https://ord.net/" },
    { name: "Ord.net", url: collectionSlug ? `https://ord.net/collection/${collectionSlug}` : "https://ord.net/" },
  ]

  let parts: (string | ReactNode)[] = [text]

  // 1. Process Brands
  brands.forEach((brand) => {
    const brandRegex = new RegExp(`(${brand.name.replace(".", "\\.")})`, "g")
    parts = processRegex(parts, brandRegex, (match, i) => (
      <a
        key={`${brand.name}-${i}`}
        href={brand.url}
        target="_blank"
        rel="noopener noreferrer"
        className="brand-link"
      >
        {match}
      </a>
    ))
  })

  // 2. Process Long On-Chain Identifiers (Addresses & Inscription IDs)
  // Simplified to catch any long hex string with 'i' and index, or standard address formats
  const onChainRegex = /(bc1[a-z0-9]{25,110}|tb1[a-z0-9]{25,110}|[a-f0-9]{64}i\d+|[13][a-z0-9]{25,45})/gi
  parts = processRegex(parts, onChainRegex, (match, i) => {
    const clean = match.trim()
    const start = clean.slice(0, 6)
    const end = clean.slice(-4)
    return (
      <span key={`onchain-${i}`} className="enhanced-identifier" title={clean}>
        {start}<span className="enhanced-identifier-dim">...</span>{end}
      </span>
    )
  })

  // 3. Process Inscription Numbers
  const inscriptionRegex = /(#\s*\d+(?:[.,]\d+)*)/g
  parts = processRegex(parts, inscriptionRegex, (match, i) => (
    <span key={`insc-${i}`} className="enhanced-identifier" title={match}>
      {match}
    </span>
  ))

  // 4. Process Block Numbers
  const blockRegex = /\b(block \d+(?:[.,]\d+)*)\b/gi
  parts = processRegex(parts, blockRegex, (match, i) => (
    <span key={`block-${i}`} className="enhanced-identifier" title={match}>
      {match}
    </span>
  ))

  // 5. Process BTC values
  const btcRegex = /\b(\d+(?:\.\d+)?\s*BTC)\b/gi
  parts = processRegex(parts, btcRegex, (match, i) => (
    <span key={`btc-${i}`} className="enhanced-identifier" title={match}>
      {match}
    </span>
  ))

  return <>{parts}</>
}

function processRegex(
  parts: (string | ReactNode)[],
  regex: RegExp,
  renderMatch: (match: string, idx: number) => ReactNode
): (string | ReactNode)[] {
  const newParts: (string | ReactNode)[] = []
  let matchIndex = 0

  parts.forEach((part) => {
    if (typeof part !== "string") {
      newParts.push(part)
      return
    }

    // Since our regexes always have exactly ONE outer capture group,
    // split() will return an array where odd indices (1, 3, 5...) are the matched groups.
    const split = part.split(regex)
    split.forEach((s, i) => {
      if (i % 2 === 1) { // It's a captured match
        if (s !== undefined) {
          newParts.push(renderMatch(s, matchIndex++))
        }
      } else if (s !== "") { // It's a non-matching text segment
        newParts.push(s)
      }
    })
  })

  return newParts
}
