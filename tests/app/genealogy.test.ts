import { describe, expect, it } from "vitest"
import {
  buildGenealogyConnections,
  buildGenealogyLevels,
  getGenealogyNodeDomId,
} from "../../src/app/lib/genealogy"
import type { RelatedInscriptionSummary } from "../../src/app/lib/types"

function makeSummary(
  inscriptionId: string,
  inscriptionNumber: number,
  relatedToIds?: string[]
): RelatedInscriptionSummary {
  return {
    inscription_id: inscriptionId,
    inscription_number: inscriptionNumber,
    content_type: "image/png",
    content_url: `https://ordinals.com/content/${inscriptionId}`,
    related_to_ids: relatedToIds,
  }
}

describe("genealogy helpers", () => {
  it("keeps the existing root-to-child fallback when there are no grandchildren", () => {
    const root = makeSummary("rooti0", 7)
    const child = makeSummary("child-1i0", 8)
    const levels = buildGenealogyLevels({
      greatGrandparents: [],
      grandparents: [],
      parents: [],
      root,
      children: [child],
      grandchildren: [],
    })

    expect(levels.map((level) => [level.id, level.items.length])).toEqual([
      ["ggp", 0],
      ["gp", 0],
      ["p", 0],
      ["root", 1],
      ["child", 1],
      ["grandchild", 0],
    ])

    expect(buildGenealogyConnections(levels, root.inscription_id)).toContainEqual({
      startId: "node-root",
      endId: "node-child-1i0",
      key: "child-root-child-1i0-fallback",
    })
  })

  it("connects grandchildren to their direct child lineage instead of falling back to the root", () => {
    const root = makeSummary("rooti0", 7)
    const childOne = makeSummary("child-1i0", 8)
    const childTwo = makeSummary("child-2i0", 9)
    const grandchild = makeSummary("grandchild-1i0", 10, ["child-1i0"])
    const sharedGrandchild = makeSummary("shared-grandchildi0", 11, ["child-1i0", "child-2i0"])

    const levels = buildGenealogyLevels({
      greatGrandparents: [],
      grandparents: [],
      parents: [],
      root,
      children: [childOne, childTwo],
      grandchildren: [grandchild, sharedGrandchild],
    })
    const connections = buildGenealogyConnections(levels, root.inscription_id)

    expect(connections).toContainEqual({
      startId: "node-child-1i0",
      endId: "node-grandchild-1i0",
      key: "grandchild-1i0-child-1i0",
    })
    expect(connections).toContainEqual({
      startId: "node-child-1i0",
      endId: "node-shared-grandchildi0",
      key: "shared-grandchildi0-child-1i0",
    })
    expect(connections).toContainEqual({
      startId: "node-child-2i0",
      endId: "node-shared-grandchildi0",
      key: "shared-grandchildi0-child-2i0",
    })
    expect(
      connections.some((connection) =>
        connection.startId === "node-root" &&
        connection.endId === getGenealogyNodeDomId("grandchild-1i0", root.inscription_id)
      )
    ).toBe(false)
  })
})
