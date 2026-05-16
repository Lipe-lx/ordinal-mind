import { describe, expect, it } from "vitest"
import { buildWikiContributionSessionId, resolveContributionStatusMessage } from "../../src/app/components/WikiContributionModal"

describe("WikiPage contribution helpers", () => {
  it("builds a stable session id for direct wiki submissions", () => {
    expect(buildWikiContributionSessionId("runestone", "founder")).toBe("wiki-page:runestone:founder")
  })

  it("maps contribution statuses into user-facing modal feedback", () => {
    expect(resolveContributionStatusMessage("published")).toBe("Your contribution was published to Drafts.")
    expect(resolveContributionStatusMessage("duplicate")).toBe("This draft already matches the latest contribution for this field.")
    expect(resolveContributionStatusMessage("quarantine")).toBe("Your contribution was saved for moderator review.")
  })
})
