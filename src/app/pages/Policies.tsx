import { useEffect } from "react"
import { Link, useLocation, useOutletContext } from "react-router"
import type { LayoutOutletContext } from "../components/Layout"

const LAST_UPDATE = "May 8, 2026"

export function Policies() {
  const location = useLocation()
  const { setHeaderCenter } = useOutletContext<LayoutOutletContext>()

  useEffect(() => {
    setHeaderCenter(<h1 className="layout-header-title">Policies</h1>)
    return () => setHeaderCenter(null)
  }, [setHeaderCenter])

  return (
    <article className="legal-page fade-in">
      <div className="legal-card">
        <p className="legal-meta">Last updated: {LAST_UPDATE}</p>
        <p>
          These policies explain how Ordinal Mind handles public data, community contributions, and user privacy in alignment with the product promise: factual first, public data only, and no server-side custody of user LLM secrets.
        </p>

        <h2>1. Public-data policy</h2>
        <p>
          Ordinal Mind aggregates and normalizes public, cacheable information. Events are intended to be source-backed and traceable to public sources such as on-chain data, ordinals.com, mempool.space, and discovered public references.
        </p>

        <h2>2. Inscription content policy</h2>
        <p>
          Inscription content is created by third parties and lives on public infrastructure. Ordinal Mind does not author, own, or control inscription content and is not responsible for legality, quality, safety, or rights status of any inscription media or metadata.
        </p>

        <h2>3. Wiki contribution policy</h2>
        <p>
          Wiki entries and edits are user-generated contributions. Ordinal Mind may apply community weighting and review flows, but does not guarantee that every field is correct, complete, non-infringing, or up to date.
        </p>

        <h2>4. Narrative and AI policy</h2>
        <p>
          Narrative outputs are optional enhancements and may be incomplete or wrong. The factual timeline remains the primary product output. If AI synthesis is unavailable or fails, the platform should still provide factual timeline data.
        </p>

        <h2>5. BYOK and key-handling policy</h2>
        <p>
          User LLM API keys are handled client-side. Ordinal Mind does not intentionally collect, proxy, persist, or inspect those keys server-side. Authenticated users can store encrypted keys in browser local storage; guests can use session-only storage.
        </p>

        <h2>6. Privacy and telemetry policy</h2>
        <p>
          Ordinal Mind is designed to minimize private-data handling. Public asset identifiers may be processed for request resolution, caching, and debugging. Users should avoid submitting sensitive personal data into wiki fields or prompts.
        </p>

        <h2>7. External-source policy</h2>
        <p>
          Third-party APIs, explorers, and discovery sources can fail, throttle, change schema, or go offline. Ordinal Mind may return partial results and does not guarantee uninterrupted coverage from every external source.
        </p>

        <h2>8. Community and enforcement policy</h2>
        <p>
          We may restrict abusive behavior, spam, or attempts to degrade service integrity. Enforcement can include filtering, moderation actions, or access restrictions where appropriate and legally required.
        </p>

        <h2>9. Policy updates</h2>
        <p>
          Policies may change as legal obligations, security needs, or product architecture evolve. Material updates are reflected by the updated date shown on this page.
        </p>

        <p className="legal-links-line">
          See also <Link to={`/terms${location.search}`}>Terms of Use</Link>.
        </p>
      </div>
    </article>
  )
}
