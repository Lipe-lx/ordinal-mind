import type { RelatedInscriptionSummary } from "./types"

export type GenealogyLevelId =
  | "ggp"
  | "gp"
  | "p"
  | "root"
  | "child"
  | "grandchild"

export interface GenealogyLevel {
  id: GenealogyLevelId
  items: RelatedInscriptionSummary[]
}

export interface GenealogyConnection {
  startId: string
  endId: string
  key: string
}

export function getGenealogyNodeDomId(
  inscriptionId: string,
  rootInscriptionId: string
): string {
  return inscriptionId === rootInscriptionId
    ? "node-root"
    : `node-${inscriptionId}`
}

export function buildGenealogyLevels(args: {
  greatGrandparents: RelatedInscriptionSummary[]
  grandparents: RelatedInscriptionSummary[]
  parents: RelatedInscriptionSummary[]
  root: RelatedInscriptionSummary
  children: RelatedInscriptionSummary[]
  grandchildren: RelatedInscriptionSummary[]
  maxVisiblePerLevel?: number
}): GenealogyLevel[] {
  const maxVisiblePerLevel = args.maxVisiblePerLevel ?? 9

  return [
    { id: "ggp", items: args.greatGrandparents.slice(0, maxVisiblePerLevel) },
    { id: "gp", items: args.grandparents.slice(0, maxVisiblePerLevel) },
    { id: "p", items: args.parents.slice(0, maxVisiblePerLevel) },
    { id: "root", items: [args.root] },
    { id: "child", items: args.children.slice(0, maxVisiblePerLevel) },
    { id: "grandchild", items: args.grandchildren.slice(0, maxVisiblePerLevel) },
  ]
}

export function buildGenealogyConnections(
  levels: GenealogyLevel[],
  rootInscriptionId: string
): GenealogyConnection[] {
  const renderedNodesMap = new Map<
    string,
    { item: RelatedInscriptionSummary; levelId: GenealogyLevelId; domId: string }
  >()

  levels.forEach((level) => {
    level.items.forEach((item) => {
      renderedNodesMap.set(item.inscription_id, {
        item,
        levelId: level.id,
        domId: getGenealogyNodeDomId(item.inscription_id, rootInscriptionId),
      })
    })
  })

  return levels.flatMap((currentLevel, levelIdx) => {
    return currentLevel.items.flatMap((node) => {
      const nodeDomId = getGenealogyNodeDomId(node.inscription_id, rootInscriptionId)
      const explicitRelations = node.related_to_ids || []

      const renderedExplicitParents = explicitRelations
        .map((id) => renderedNodesMap.get(id))
        .filter(
          (parent): parent is { item: RelatedInscriptionSummary; levelId: GenealogyLevelId; domId: string } =>
            Boolean(parent)
        )

      if (renderedExplicitParents.length > 0) {
        return renderedExplicitParents.map((parent) => ({
          startId: parent.domId,
          endId: nodeDomId,
          key: `${node.inscription_id}-${parent.item.inscription_id}`,
        }))
      }

      if (currentLevel.id === "root") {
        const parentLevel = levels.find((level) => level.id === "p")
        return (parentLevel?.items || []).map((parent) => ({
          startId: getGenealogyNodeDomId(parent.inscription_id, rootInscriptionId),
          endId: "node-root",
          key: `root-p-${parent.inscription_id}-fallback`,
        }))
      }

      if (currentLevel.id === "child") {
        return [{
          startId: "node-root",
          endId: nodeDomId,
          key: `child-root-${node.inscription_id}-fallback`,
        }]
      }

      let fallbackLevelIdx = -1
      for (let index = levelIdx - 1; index >= 0; index--) {
        if (levels[index].items.length > 0) {
          fallbackLevelIdx = index
          break
        }
      }

      if (fallbackLevelIdx !== -1) {
        const fallbackLevel = levels[fallbackLevelIdx]
        return fallbackLevel.items.map((parent) => ({
          startId: getGenealogyNodeDomId(parent.inscription_id, rootInscriptionId),
          endId: nodeDomId,
          key: `${node.inscription_id}-${parent.inscription_id}-fallback`,
        }))
      }

      return []
    })
  })
}
