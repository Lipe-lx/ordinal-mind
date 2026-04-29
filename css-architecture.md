# Ordinal Mind — CSS Architecture

> Análise completa do `index.css` (5 415 linhas / 117 KB) e proposta de separação modular.

---

## Diagnósticos encontrados no arquivo atual

| Problema | Detalhe |
|---|---|
| `--danger` declarado duas vezes | Em `:root` (linha ~64) e novamente num bloco isolado lá embaixo |
| Scrollbar repetida ~12 vezes | Exatamente o mesmo bloco `-webkit-scrollbar` copiado em cada container |
| `@keyframes` misturados com componentes | Ex: `node-reveal`, `genesis-pulse`, `card-glow` aparecem no meio das regras de componente |
| Sem separação de responsabilidades | Layout, widget, página e animação misturados no mesmo espaço plano |

---

## Arquitetura proposta

```
styles/
│
├── index.css                        ← apenas @import, zero regras
│
├── base/
│   ├── tokens.css                   ← :root com todos os CSS Custom Properties
│   ├── reset.css                    ← *, html, body, #root, scroll-behavior
│   └── typography.css               ← a, .brand-link
│
├── utils/
│   ├── scrollbar.css                ← um único mixin de scrollbar reutilizado via @layer
│   ├── animations.css               ← @keyframes globais: fade-in, spin, skeleton-shimmer, blink
│   └── utilities.css                ← .fade-in, .glass-card
│
├── components/
│   ├── button.css                   ← .btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-minimal-key
│   ├── input.css                    ← .input-field, select.input-field
│   ├── tooltip.css                  ← .portal-tooltip + setas + animações de entrada
│   ├── skeleton.css                 ← .skeleton, .skeleton-text, .skeleton-card, .loading-spinner
│   ├── badge.css                    ← .sat-badge (tiers), .charm-badge, .provider-badge, .node-badge
│   └── modal.css                    ← base para overlays: .byok-overlay/.byok-modal
│
├── layout/
│   ├── app-layout.css               ← .layout, .layout-header, .layout-main, .layout-footer, .layout-logo
│   └── error-boundary.css           ← .error-boundary, .error-details
│
├── pages/
│   ├── home.css                     ← .home, .home-title, .home-search, .home-hint, .home-error
│   └── address.css                  ← .address-list, .address-item
│
├── features/
│   │
│   ├── chronicle/
│   │   ├── chronicle-layout.css     ← .chronicle-page, .chronicle (grid), sidebars, media queries
│   │   ├── chronicle-card.css       ← .chronicle-card, preview, text-preview, narrative, actions
│   │   ├── chronicle-tabs.css       ← .chronicle-tabs, .chronicle-tab, .tab-arrow, layout modes
│   │   └── chronicle-nav.css        ← .inscription-nav-overlay, .nav-btn, .preview-fullscreen-*
│   │
│   ├── timeline/
│   │   ├── timeline-panel.css       ← .timeline-panel, header, scroll-container, count
│   │   ├── temporal-tree.css        ← .temporal-tree, .timeline-node, data-type variants, disclaimer
│   │   └── timeline-price.css       ← .timeline-node-price, .timeline-node-heuristic
│   │
│   ├── narrative/
│   │   ├── narrative-content.css    ← .narrative-section, .narrative-content, paragraphs, drop-cap
│   │   ├── narrative-states.css     ← loading, empty, error, cursor, stream-preview
│   │   ├── narrative-logs.css       ← .narrative-research-logs, .narrative-log-*, .narrative-logs-toggle
│   │   ├── narrative-chat.css       ← .narrative-chat-shell, transcript, input, footer, icon btns
│   │   └── chat-history.css         ← .chat-history-overlay, modal, list, items, actions
│   │
│   ├── genealogy/
│   │   ├── genealogy-bg.css         ← .genealogy-bg, layers, grid, dots, scanline
│   │   ├── genealogy-tree.css       ← .genealogy-container, tree, row, node, node-card
│   │   ├── genealogy-media.css      ← .node-image, .media-text-preview, .media-placeholder
│   │   ├── genealogy-detail.css     ← .node-detail-overlay, card, stats, .explorer-*
│   │   └── genealogy-svg.css        ← .genealogy-path, .genealogy-connections, @keyframes energy-flow
│   │
│   ├── signals/
│   │   └── signals.css              ← .signals-panel, header, content, grid, metric, evidence, nav
│   │
│   └── scan/
│       └── scan-progress.css        ← .scan-progress, steps, bar-track, bar-fill, footer
│
└── widgets/
    ├── widget-meta.css              ← .widget-meta-grid, cell, label, value, sub, action-btn
    ├── widget-provenance.css        ← .widget-provenance (bloco maior, ~200 linhas)
    ├── widget-ownership.css         ← .widget-ownership, chain, address-pill, tx-badge
    ├── widget-sources.css           ← .widget-sources-minimal, inline, expanded, detail-card
    └── widget-rarity.css            ← .widget-rarity-grid-wrapper, pagination, rank-cell, footer
```

---

## Como fica o `index.css` final

```css
/* Ordinal Mind — Design System Entry Point */
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap');

/* Base */
@import './base/tokens.css';
@import './base/reset.css';
@import './base/typography.css';

/* Utils */
@import './utils/scrollbar.css';
@import './utils/animations.css';
@import './utils/utilities.css';

/* Components */
@import './components/button.css';
@import './components/input.css';
@import './components/tooltip.css';
@import './components/skeleton.css';
@import './components/badge.css';
@import './components/modal.css';

/* Layout */
@import './layout/app-layout.css';
@import './layout/error-boundary.css';

/* Pages */
@import './pages/home.css';
@import './pages/address.css';

/* Features — Chronicle */
@import './features/chronicle/chronicle-layout.css';
@import './features/chronicle/chronicle-card.css';
@import './features/chronicle/chronicle-tabs.css';
@import './features/chronicle/chronicle-nav.css';

/* Features — Timeline */
@import './features/timeline/timeline-panel.css';
@import './features/timeline/temporal-tree.css';
@import './features/timeline/timeline-price.css';

/* Features — Narrative */
@import './features/narrative/narrative-content.css';
@import './features/narrative/narrative-states.css';
@import './features/narrative/narrative-logs.css';
@import './features/narrative/narrative-chat.css';
@import './features/narrative/chat-history.css';

/* Features — Genealogy */
@import './features/genealogy/genealogy-bg.css';
@import './features/genealogy/genealogy-tree.css';
@import './features/genealogy/genealogy-media.css';
@import './features/genealogy/genealogy-detail.css';
@import './features/genealogy/genealogy-svg.css';

/* Features — Signals & Scan */
@import './features/signals/signals.css';
@import './features/scan/scan-progress.css';

/* Widgets */
@import './widgets/widget-meta.css';
@import './widgets/widget-provenance.css';
@import './widgets/widget-ownership.css';
@import './widgets/widget-sources.css';
@import './widgets/widget-rarity.css';
```

---

## Quick wins antes de migrar

### 1. Consolidar o scrollbar repetido

Cria `utils/scrollbar.css` com uma classe utilitária:

```css
/* utils/scrollbar.css */
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
}
.scrollbar-thin::-webkit-scrollbar        { width: 5px; }
.scrollbar-thin::-webkit-scrollbar-track  { background: transparent; }
.scrollbar-thin::-webkit-scrollbar-thumb  { background: rgba(255,255,255,.08); border-radius: 4px; }
.scrollbar-thin::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.15); }
```

Depois adiciona `class="scrollbar-thin"` nos elementos via JSX. Elimina ~60 linhas de CSS duplicado.

### 2. Remover o `--danger` duplicado

Está declarado duas vezes. Mantém só em `base/tokens.css` dentro do `:root`.

### 3. Mover todos os `@keyframes` globais

`fade-in`, `spin`, `skeleton-shimmer`, `blink`, `pulse-glow`, `dot-pulse` → `utils/animations.css`.
Cada feature file fica com apenas seus `@keyframes` específicos (ex: `genesis-pulse`, `energy-flow`).

---

## Tamanho estimado por arquivo após separação

| Arquivo | Linhas aprox. |
|---|---|
| `features/narrative/narrative-chat.css` | ~350 |
| `features/chronicle/chronicle-card.css` | ~320 |
| `features/genealogy/genealogy-tree.css` | ~280 |
| `widgets/widget-provenance.css` | ~260 |
| `base/tokens.css` | ~110 |
| `features/timeline/temporal-tree.css` | ~200 |
| Demais arquivos | 50–150 cada |

Nenhum arquivo ultrapassa 400 linhas.

---

## Estratégia de migração sem quebrar nada

1. **Cria a estrutura de pastas** mas mantém o `index.css` original intacto
2. **Copia** cada seção para o novo arquivo correspondente (não recorta ainda)
3. **Substitui** o `index.css` pelo novo entry point com `@import`s
4. **Remove** as seções do `index.css` original, uma feature de cada vez
5. **Verifica** no browser após cada remoção — o CSS Modules de um arquivo não bate com outro, fácil de isolar

> Se o projeto usar **Vite**, os `@import` de CSS são resolvidos em build time — zero overhead. Se usar **Next.js com App Router**, importa o `index.css` no `layout.tsx` normalmente, os imports internos são resolvidos pelo bundler.
