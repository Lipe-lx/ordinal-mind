import { useEffect } from "react"
import { Link, useLocation, useOutletContext } from "react-router"
import type { LayoutOutletContext } from "../components/Layout"

const LAST_UPDATE = "May 8, 2026"

export function TermsOfUse() {
  const location = useLocation()
  const { setHeaderCenter } = useOutletContext<LayoutOutletContext>()

  useEffect(() => {
    setHeaderCenter(<h1 className="layout-header-title">Termos de Uso</h1>)
    return () => setHeaderCenter(null)
  }, [setHeaderCenter])

  return (
    <article className="legal-page fade-in">
      <div className="legal-card">
        <p className="legal-meta">Last updated: {LAST_UPDATE}</p>
        <p>
          These Terms of Use govern your access to and use of Ordinal Mind. By using the platform, you agree to these terms.
        </p>

        <h2>1. Service nature</h2>
        <p>
          Ordinal Mind is a factual memory engine for Bitcoin Ordinals. The service aggregates public data to build a verifiable asset timeline, with optional narrative and collaborative wiki layers.
        </p>

        <h2>2. No custody and no server-side LLM key handling</h2>
        <p>
          Ordinal Mind does not receive, store, or custody wallet private keys or user LLM API keys. BYOK AI features run client-side and remain the user&apos;s responsibility.
        </p>

        <h2>3. Inscription content disclaimer</h2>
        <p>
          Ordinal Mind does not create, endorse, pre-moderate, own, or control inscription content on-chain. All inscription content, media, and metadata remain solely the responsibility of their authors/originators.
        </p>

        <h2>4. Wiki contribution disclaimer</h2>
        <p>
          Wiki fields, descriptions, links, and related information are third-party user contributions. Ordinal Mind does not guarantee their accuracy, completeness, legality, ownership, or ongoing correctness.
        </p>

        <h2>5. No legal, financial, or tax advice</h2>
        <p>
          Ordinal Mind content is informational only. Nothing on the platform constitutes legal, financial, tax, or investment advice.
        </p>

        <h2>6. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Ordinal Mind and its maintainers are not liable for direct or indirect losses, including damages from inaccurate third-party data, external source downtime, unlawful third-party content, or decisions made using this platform.
        </p>

        <h2>7. Acceptable use</h2>
        <ul>
          <li>Do not use the service to violate applicable laws.</li>
          <li>Do not attempt to degrade service quality, bypass limits, or compromise platform security.</li>
          <li>Do not knowingly submit false, misleading, defamatory, or rights-infringing content.</li>
        </ul>

        <h2>8. Public-source and third-party dependency</h2>
        <p>
          Ordinal Mind depends on public data and third-party providers. Failures, delays, or upstream changes may produce partial, delayed, or unavailable data without notice.
        </p>

        <h2>9. Changes to terms</h2>
        <p>
          These terms may be updated to reflect legal, technical, or product changes. Continued use after updates means acceptance of the current version.
        </p>

        <h2>10. Contact</h2>
        <p>
          For questions about these terms and policies, use the project&apos;s public channels in the official repository.
        </p>

        <p className="legal-links-line">
          See also <Link to={`/policies${location.search}`}>Policies</Link>.
        </p>
      </div>
    </article>
  )
}
