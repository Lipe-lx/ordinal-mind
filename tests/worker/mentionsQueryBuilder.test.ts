import { describe, expect, it } from "vitest"
import { buildMentionQueries } from "../../src/worker/agents/mentions/queryBuilder"

describe("buildMentionQueries", () => {
  it("prioritizes collection labels before inscription-specific precision queries", () => {
    expect(buildMentionQueries({
      inscriptionId: `${"a".repeat(64)}i0`,
      inscriptionNumber: 2971,
      collectionName: "Bitcoin Puppets",
      itemName: "Bitcoin Puppet #2971",
      fullLabel: "Bitcoin Puppet #2971 · Bitcoin Puppets",
    })).toEqual([
      {
        text: "\"Bitcoin Puppets\"",
        matchType: "collection_only",
        scope: "collection_level",
        limit: 8,
        matchWeight: 1,
      },
      {
        text: "\"Bitcoin Puppet #2971 · Bitcoin Puppets\"",
        matchType: "item_plus_collection",
        scope: "mixed",
        limit: 5,
        matchWeight: 0.95,
      },
      {
        text: "\"Bitcoin Puppet #2971\"",
        matchType: "item_only",
        scope: "inscription_level",
        limit: 3,
        matchWeight: 0.55,
      },
      {
        text: "\"inscription 2971\"",
        matchType: "inscription_number",
        scope: "inscription_level",
        limit: 2,
        matchWeight: 0.5,
      },
      {
        text: `"${"a".repeat(64)}i0"`,
        matchType: "inscription_id",
        scope: "inscription_level",
        limit: 2,
        matchWeight: 0.7,
      },
    ])
  })
})
