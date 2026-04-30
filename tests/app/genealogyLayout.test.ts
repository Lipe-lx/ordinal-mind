import { describe, expect, it } from "vitest"
import {
  computeGenealogyAutoFitScale,
  GENEALOGY_LAYOUT_SETTLE_DELAYS_MS,
} from "../../src/app/lib/genealogyLayout"

describe("genealogy layout helpers", () => {
  it("keeps a bounded retry window for asynchronous media rendering", () => {
    expect(GENEALOGY_LAYOUT_SETTLE_DELAYS_MS[0]).toBe(0)
    expect(GENEALOGY_LAYOUT_SETTLE_DELAYS_MS.at(-1)).toBe(1900)
    expect([...GENEALOGY_LAYOUT_SETTLE_DELAYS_MS]).toEqual(
      [...GENEALOGY_LAYOUT_SETTLE_DELAYS_MS].slice().sort((a, b) => a - b)
    )
  })

  it("computes a boosted and clamped auto-fit scale", () => {
    expect(computeGenealogyAutoFitScale({
      containerWidth: 600,
      containerHeight: 400,
      treeWidth: 1200,
      treeHeight: 1000,
    })).toBeCloseTo(0.44, 5)

    expect(computeGenealogyAutoFitScale({
      containerWidth: 50,
      containerHeight: 50,
      treeWidth: 3000,
      treeHeight: 3000,
    })).toBe(0.15)

    expect(computeGenealogyAutoFitScale({
      containerWidth: 4000,
      containerHeight: 4000,
      treeWidth: 500,
      treeHeight: 500,
    })).toBe(1.2)
  })
})
