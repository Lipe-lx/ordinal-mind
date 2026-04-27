import React from "react"

const BRANDS = [
  { name: "Satflow", url: "https://www.satflow.com/" },
  { name: "ord.net", url: "https://ord.net/" },
  { name: "Ord.net", url: "https://ord.net/" },
]

export function linkifyBrands(text: string, collectionSlug?: string): React.ReactNode {
  if (!text) return text
  
  const brands = [
    { name: "Satflow", url: collectionSlug ? `https://www.satflow.com/ordinals/${collectionSlug}` : "https://www.satflow.com/" },
    { name: "ord.net", url: collectionSlug ? `https://ord.net/collection/${collectionSlug}` : "https://ord.net/" },
    { name: "Ord.net", url: collectionSlug ? `https://ord.net/collection/${collectionSlug}` : "https://ord.net/" },
  ]
  
  let parts: (string | React.ReactNode)[] = [text]
  
  brands.forEach(brand => {
    const newParts: (string | React.ReactNode)[] = []
    parts.forEach(part => {
      if (typeof part !== "string") {
        newParts.push(part)
        return
      }
      
      const regex = new RegExp(`(${brand.name})`, "g")
      const split = part.split(regex)
      
      split.forEach((s, i) => {
        if (s === brand.name) {
          newParts.push(
            <a 
              key={`${brand.name}-${i}`}
              href={brand.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="brand-link"
            >
              {s}
            </a>
          )
        } else if (s !== "") {
          newParts.push(s)
        }
      })
    })
    parts = newParts
  })
  
  return <>{parts}</>
}
