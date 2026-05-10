import { useEffect } from "react"
import { useLocation } from "react-router"

export function Docs() {
  const { hash } = useLocation()

  useEffect(() => {
    if (hash) {
      const element = document.getElementById(hash.replace("#", ""))
      if (element) {
        element.scrollIntoView({ behavior: "smooth" })
      }
    }
  }, [hash])

  const sections = [
    {
      title: "Fundamentals",
      links: [
        { id: "introduction", label: "Introduction" },
        { id: "product-thesis", label: "Product Thesis" },
        { id: "how-it-works", label: "How it Works" },
      ],
    },
    {
      title: "Core Features",
      links: [
        { id: "temporal-tree", label: "Temporal Tree" },
        { id: "chronicle-narrative", label: "Chronicle Narrative" },
        { id: "wiki-atlas", label: "Wiki Atlas" },
      ],
    },
    {
      title: "Identity & Trust",
      links: [
        { id: "byok", label: "BYOK (Privacy)" },
        { id: "discord-identity", label: "Discord & Tiers" },
        { id: "consensus", label: "Community Consensus" },
      ],
    },
    {
      title: "Agent Layer",
      links: [
        { id: "mcp", label: "MCP Protocol" },
        { id: "agent-tools", label: "Agentic Tools" },
        { id: "mcp-oauth", label: "MCP OAuth2" },
      ],
    },
  ]

  return (
    <div className="docs-page">
      <aside className="docs-sidebar">
        {sections.map((group) => (
          <div key={group.title} className="docs-nav-group">
            <h3 className="docs-nav-title">{group.title}</h3>
            {group.links.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                className={`docs-nav-link ${hash === `#${link.id}` ? "active" : ""}`}
              >
                {link.label}
              </a>
            ))}
          </div>
        ))}
      </aside>

      <div className="docs-content-wrap">
        <article className="docs-article">
          <header>
            <h1 id="introduction">Documentation</h1>
            <p className="docs-intro">
              Welcome to the OrdinalMind documentation. This resource explains the philosophy, 
              technology, and features behind the first factual memory engine for Bitcoin Ordinals.
            </p>
          </header>

          <section>
            <h2 id="product-thesis">Product Thesis</h2>
            <p>
              OrdinalMind was built with a clear promise: <strong>Factual first, public data only.</strong> 
              Unlike many AI-driven tools that prioritize creative storytelling over accuracy, 
              OrdinalMind treats the blockchain as the ultimate source of truth.
            </p>
            <blockquote>
              The raw event tree is the product. The Chronicle narrative and Wiki layers are enhancements.
            </blockquote>
            <p>
              We believe that collectors need a verifiable timeline, not just a generated story. 
              Every event in your Chronicle is traceable to a public source, whether it's an on-chain 
              transaction, a marketplace listing, or a documented social reference.
            </p>
          </section>

          <section>
            <h2 id="how-it-works">How it Works</h2>
            <p>
              When you provide an inscription number or a Taproot address, OrdinalMind triggers 
              a multi-layered discovery process:
            </p>
            <ul>
              <li><strong>Resolution:</strong> We normalize the input and identify the target asset.</li>
              <li><strong>Discovery:</strong> Our workers aggregate data from public APIs, indexers, and web signals.</li>
              <li><strong>Timeline Construction:</strong> We merge, deduplicate, and sort events chronologically.</li>
              <li><strong>Consensus:</strong> We layer community-vetted information from the Wiki Atlas.</li>
              <li><strong>Synthesis:</strong> If enabled, an LLM generates a narrative based strictly on the gathered facts.</li>
            </ul>
          </section>

          <section>
            <h2 id="temporal-tree">Temporal Tree</h2>
            <p>
              The Temporal Tree is the heart of the experience. It is a visual, interactive graph 
              representing the provenance of an Ordinal. It doesn't just show ownership; it shows 
              the <em>flow</em> of value, the moments of discovery, and the cultural milestones 
              associated with the asset.
            </p>
          </section>

          <section>
            <h2 id="chronicle-narrative">Chronicle Narrative</h2>
            <p>
              The narrative layer translates complex technical data into a readable history. 
              By default, this is a factual summary. However, users can use their own AI keys 
              to generate more descriptive "Chronicles" that maintain the factual integrity 
              of the underlying data.
            </p>
          </section>

          <section>
            <h2 id="wiki-atlas">Wiki Atlas</h2>
            <p>
              The Wiki Atlas is our community-driven knowledge base. It allows collectors to 
              contribute missing context—such as artist names, collection lore, or founder 
              details—that might not be directly available on-chain.
            </p>
            <p>
              Contributions are weighted based on <strong>Discord Tiers</strong> to ensure 
              high-quality data and prevent misinformation.
            </p>
            <p>
              Additionally, our <strong>Wiki Seed Agent</strong> proactively extracts 
              structured data from initial narratives to bootstrap new wiki entries, 
              which can then be refined and validated by the community.
            </p>
          </section>

          <section>
            <h2 id="byok">BYOK (Bring Your Own Key)</h2>
            <p>
              Privacy and security are non-negotiable. OrdinalMind follows a strict 
              <strong>BYOK</strong> (Bring Your Own Key) policy:
            </p>
            <ul>
              <li>The server never receives or stores your LLM API keys.</li>
              <li>Synthesis happens entirely on the client side (in your browser).</li>
              <li>Keys are stored encrypted in your local storage.</li>
            </ul>
            <p>
              This ensures that you retain full control over your AI usage and secrets 
              at all times.
            </p>
          </section>

          <section>
            <h2 id="discord-identity">Discord & Tiers</h2>
            <p>
              We use Discord OAuth2 for identity and community consensus. Your tier 
              defines your influence within the Wiki Atlas:
            </p>
            <ul>
              <li><strong>Genesis:</strong> Project founders and core maintainers.</li>
              <li><strong>OG:</strong> Early contributors and recognized community members.</li>
              <li><strong>Community:</strong> Verified members of the OrdinalMind ecosystem.</li>
            </ul>
          </section>

          <section>
            <h2 id="consensus">Community Consensus</h2>
            <p>
              When multiple users contribute different values for the same Wiki field, 
              OrdinalMind uses a consensus algorithm that prioritizes data from 
              higher-tier members. This ensures that the consolidated view always 
              reflects the most trusted information available.
            </p>
          </section>

          <section>
            <h2 id="mcp">Agent Layer (MCP)</h2>
            <p>
              OrdinalMind is designed not just for humans, but for the next generation of AI agents. 
              We implement the <strong>Model Context Protocol (MCP)</strong>, an open standard that 
              allows AI models to interact with our factual core in a structured, verifiable way.
            </p>
            <blockquote>
              The Agent Layer bridges the gap between raw blockchain data and autonomous research agents.
            </blockquote>
          </section>

          <section>
            <h2 id="agent-tools">Agentic Tools</h2>
            <p>
              Through MCP, agents gain access to a suite of specialized tools to perform 
              deep research on Ordinals:
            </p>
            <ul>
              <li><strong>query_chronicle:</strong> Technical audit of an inscription's history.</li>
              <li><strong>wiki_search_pages:</strong> Discovery of collections and assets.</li>
              <li><strong>wiki_get_collection_context:</strong> Detailed context on rarity, artists, and lore.</li>
              <li><strong>wiki_propose_update:</strong> (Authenticated) Participation in wiki governance.</li>
              <li><strong>refresh_chronicle:</strong> (Genesis/OG) Triggering fresh on-chain rescans.</li>
            </ul>
          </section>

          <section>
            <h2 id="mcp-oauth">MCP OAuth2</h2>
            <p>
              To maintain the "No Server-Side Secrets" promise while enabling agents to perform 
              authenticated actions, we've implemented <strong>MCP OAuth2</strong>.
            </p>
            <p>
              This protocol allows agents to:
            </p>
            <ul>
              <li>Dynamically register as clients.</li>
              <li>Request scoped permissions (e.g., <code>wiki.contribute</code>).</li>
              <li>Perform a secure login flow that links their session to a Discord Tier.</li>
              <li>Obtain short-lived access tokens to unlock writable tools.</li>
            </ul>
            <p>
              This ensures that even when an agent is acting on your behalf, 
              the security and tier rules of OrdinalMind remain strictly enforced.
            </p>
          </section>
        </article>
      </div>
    </div>
  )
}
