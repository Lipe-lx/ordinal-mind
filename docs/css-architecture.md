# Ordinal Mind — CSS Architecture

> Estado atual da refatoração de estilos após a modularização do antigo `src/app/index.css`.

---

## Status

- O antigo monólito de ~5.4k linhas foi desmontado.
- `src/app/index.css` agora é apenas o entrypoint global com `@import`s.
- Os estilos foram distribuídos em `src/app/styles/` por base, components, layout, pages, features e widgets.
- A UI foi validada manualmente e a build/typecheck continuam passando.

---

## Estrutura atual

```text
src/app/
├── index.css                        ← entrypoint global, apenas imports
└── styles/
    ├── base/
    │   ├── tokens.css
    │   ├── reset.css
    │   ├── glass.css
    │   └── fade-in.css
    │
    ├── components/
    │   ├── badges.css
    │   ├── buttons.css
    │   ├── inputs.css
    │   ├── modal.css
    │   ├── skeleton.css
    │   └── tooltip.css
    │
    ├── layout/
    │   ├── layout.css
    │   └── error-boundary.css
    │
    ├── pages/
    │   ├── home.css
    │   └── address.css
    │
    ├── features/
    │   ├── chronicle/
    │   │   ├── shell.css
    │   │   ├── sidebar.css
    │   │   ├── timeline.css
    │   │   ├── card.css
    │   │   ├── navigation.css
    │   │   ├── tabs.css
    │   │   └── genealogy.css
    │   ├── narrative/
    │   │   ├── content.css
    │   │   ├── chat.css
    │   │   └── history.css
    │   ├── scan/
    │   │   └── scan-progress.css
    │   └── wiki/
    │       └── wiki.css
    │
    ├── widgets/
    │   ├── meta.css
    │   ├── provenance.css
    │   ├── collection-context.css  ← alias seguro para provenance.css
    │   ├── ownership.css
    │   ├── sources.css
    │   └── rarity.css
    │
    └── legacy-responsive.css       ← bloco responsivo misto mantido separado por segurança
```

---

## Entry Point

O `src/app/index.css` deve continuar sem regras próprias, funcionando apenas como agregador do cascade global:

```css
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap');

@import "./styles/components/tooltip.css";

@import "./styles/base/tokens.css";
@import "./styles/base/reset.css";
@import "./styles/base/glass.css";

@import "./styles/layout/layout.css";

@import "./styles/components/buttons.css";
@import "./styles/components/inputs.css";

@import "./styles/pages/home.css";

@import "./styles/features/chronicle/shell.css";
@import "./styles/features/chronicle/sidebar.css";
@import "./styles/features/chronicle/timeline.css";
@import "./styles/features/chronicle/card.css";

@import "./styles/components/badges.css";
@import "./styles/widgets/rarity.css";

@import "./styles/components/modal.css";
@import "./styles/components/skeleton.css";

@import "./styles/layout/error-boundary.css";
@import "./styles/pages/address.css";

@import "./styles/base/fade-in.css";
@import "./styles/features/scan/scan-progress.css";

@import "./styles/widgets/meta.css";
@import "./styles/widgets/collection-context.css";
@import "./styles/widgets/ownership.css";
@import "./styles/widgets/sources.css";

@import "./styles/features/narrative/content.css";
@import "./styles/features/narrative/chat.css";
@import "./styles/features/narrative/history.css";

@import "./styles/legacy-responsive.css";

@import "./styles/features/chronicle/navigation.css";
@import "./styles/features/chronicle/tabs.css";
@import "./styles/features/chronicle/genealogy.css";
```

Regra importante:

- Preserve a ordem dos imports, porque ela foi alinhada ao cascade do monólito original para evitar regressão visual.

---

## Tokens e contratos

Os tokens globais vivem em `base/tokens.css`.

Custom properties críticas já normalizadas:

- `--danger`
- `--color-market`
- `--border-subtle`
- `--text-dim`
- `--glass-border`

Regras de manutenção:

- Novos tokens globais entram em `base/tokens.css`.
- Não reintroduzir tokens duplicados em arquivos de feature/widget.
- Se um seletor depende de um token novo, o token deve existir antes de trocar a ordem de imports.

---

## Decisões tomadas na migração

- Mantivemos a árvore `src/app/styles/` já iniciada em vez de rebatizar tudo para um blueprint idealizado.
- Não houve mudança em JSX ou `className`; a rodada foi CSS-only.
- `collection-context.css` foi mantido como alias explícito para evitar churn desnecessário, enquanto `provenance.css` continua como source of truth.
- O bloco responsivo misto ficou em `legacy-responsive.css` para preservar comportamento sem forçar uma divisão arriscada.
- Scrollbars repetidas ainda não foram consolidadas em utilitário compartilhado, de propósito.

---

## Próximos passos seguros

1. Consolidar scrollbars repetidas em um utilitário compartilhado.
2. Avaliar extração de animações globais recorrentes para um arquivo dedicado, se isso puder ser feito sem alterar cascade.
3. Reduzir aliases/arquivos de transição como `collection-context.css` quando não houver mais risco de regressão.
4. Opcionalmente dividir `legacy-responsive.css` por domínio depois de validar cada bloco isoladamente.

---

## Validação esperada

Sempre que mexer nessa arquitetura, rodar:

- `npm run typecheck`
- `npm run build`

E validar manualmente na UI:

- Home e address selection
- Chronicle shell
- Timeline e badges
- Widgets de meta/provenance/ownership/sources/rarity
- Narrative render/chat/history
- Fullscreen preview e navigation overlay
- Tabs/layout modes
- Genealogy tree/explorer

Observação:

- O build pode exibir o warning conhecido de chunk > 500 kB.
- Em ambiente sandboxado, o Wrangler pode emitir ruído ao tentar escrever logs fora da workspace, sem invalidar a build.
