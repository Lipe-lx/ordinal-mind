---
name: cicd-monorepo
description: >
  Estrutura e audita pipelines de CI/CD para monorepos com múltiplos serviços. Use esta skill
  sempre que o usuário mencionar deploy, pipeline, GitHub Actions, Cloudflare Pages, Cloud Run,
  CI, CD, workflow, branch strategy, staging, testes automatizados, ou qualquer variação de
  "quero melhorar meu deploy". Aplique também quando o usuário perguntar se sua prática de
  deploy está correta, ou pedir para montar/revisar um workflow de CI/CD — mesmo que não use
  exatamente essas palavras.
---

# CI/CD para Monorepo (GitHub + Cloudflare + Cloud Run)

## Stack de referência do usuário

| Serviço     | Plataforma        | Diretório   |
|-------------|-------------------|-------------|
| Landpage    | Cloudflare Pages  | `website/`  |
| UI do App   | Cloudflare Pages  | `frontend/` |
| Backend     | Google Cloud Run  | `backend/`  |

Todos num único repositório GitHub (monorepo).

---

## 1. Branch Strategy (obrigatório definir antes de tudo)

```
feature/* → develop → master
               ↓            ↓
           staging       produção
```

- **`feature/*`**: qualquer mudança nova. Apenas CI roda (testes + lint).
- **`develop`**: integração contínua. Deploy automático para **staging**.
- **`master`**: produção. Deploy automático apenas após merge via Pull Request aprovado.

> ⚠️ Nunca fazer push direto na `master`. Sempre via PR com pelo menos 1 review (mesmo que seja seu próprio projeto — cria o hábito).

---

## 2. Estrutura de Workflows GitHub Actions

Criar os seguintes arquivos em `.github/workflows/`:

```
.github/workflows/
├── ci.yml          → roda em todo push/PR (lint, testes, build check)
├── cd-website.yml  → deploy da landpage (Cloudflare)
├── cd-frontend.yml → deploy do frontend (Cloudflare)
└── cd-backend.yml  → deploy do backend (Cloud Run)
```

---

## 3. Workflow de CI (ci.yml)

Roda em **todo push e PR**, em todos os serviços modificados.

```yaml
name: CI

on:
  push:
    branches: [develop, master]
  pull_request:
    branches: [develop, master]

jobs:
  ci-website:
    if: contains(github.event.head_commit.modified, 'website/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: website/package-lock.json
      - run: cd website && npm ci
      - run: cd website && npm run lint
      - run: cd website && npm run build

  ci-frontend:
    if: contains(github.event.head_commit.modified, 'frontend/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - run: cd frontend && npm ci
      - run: cd frontend && npm run lint
      - run: cd frontend && npm run test --if-present
      - run: cd frontend && npm run build

  ci-backend:
    if: contains(github.event.head_commit.modified, 'backend/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Rodar testes do backend
        # Ajuste conforme a linguagem do backend (Node, Python, Go, etc.)
        # Veja references/backend-ci.md para exemplos por linguagem
        run: cd backend && npm ci && npm test
```

> 📄 Para exemplos de CI por linguagem de backend, consulte `references/backend-ci.md`

---

## 4. Workflows de CD (deploy)

### cd-website.yml — Cloudflare Pages

```yaml
name: CD - Landpage

on:
  push:
    branches: [master]
    paths:
      - 'website/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    needs: [] # Adicionar 'ci-website' se quiser garantir que CI passou
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd website && npm ci && npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy website/dist --project-name=seu-projeto-landpage
```

### cd-frontend.yml — Cloudflare Pages

```yaml
name: CD - Frontend

on:
  push:
    branches: [master]
    paths:
      - 'frontend/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd frontend && npm ci && npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy frontend/dist --project-name=seu-projeto-frontend
```

### cd-backend.yml — Google Cloud Run

```yaml
name: CD - Backend

on:
  push:
    branches: [master]
    paths:
      - 'backend/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - id: auth
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Build e push Docker image
        run: |
          gcloud builds submit backend/ \
            --tag gcr.io/${{ secrets.GCP_PROJECT_ID }}/backend:${{ github.sha }}

      - name: Deploy no Cloud Run
        run: |
          gcloud run deploy backend \
            --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/backend:${{ github.sha }} \
            --region us-central1 \
            --platform managed \
            --allow-unauthenticated
```

> 📄 Para configurar autenticação GCP via Service Account, consulte `references/gcp-auth.md`

---

## 5. Secrets necessários no GitHub

Adicionar em **Settings → Secrets and variables → Actions**:

| Secret                  | Usado em              |
|-------------------------|-----------------------|
| `CLOUDFLARE_API_TOKEN`  | cd-website, cd-frontend |
| `CLOUDFLARE_ACCOUNT_ID` | cd-website, cd-frontend |
| `GCP_SA_KEY`            | cd-backend            |
| `GCP_PROJECT_ID`        | cd-backend            |

---

## 6. Checklist de auditoria antes de cada deploy

Antes de fazer merge na `master`, verificar:

- [ ] CI passou (lint + testes + build) na branch de feature
- [ ] PR criado e revisado (mesmo que auto-revisado)
- [ ] Variáveis de ambiente de produção estão corretas
- [ ] Mudanças de banco de dados têm migration versionada
- [ ] Endpoint de health check do backend está respondendo em staging

---

## 7. Boas práticas rápidas

- **Nunca commitar secrets** — usar GitHub Secrets ou `.env` no `.gitignore`
- **Versionar a imagem Docker** com o `github.sha` (nunca usar `:latest` em produção)
- **Cloud Run tem rollback nativo**: `gcloud run services update-traffic --to-revisions=REVISION=100`
- **Cloudflare Pages mantém histórico** de deploys com rollback no dashboard
- Usar `npm ci` (não `npm install`) em CI — garante instalação determinística

---

## Quando usar cada reference file

| Situação                                      | Arquivo                        |
|-----------------------------------------------|--------------------------------|
| Backend em Python, Go ou outra linguagem       | `references/backend-ci.md`    |
| Configurar Service Account no GCP             | `references/gcp-auth.md`      |
| Montar ambiente de staging separado            | `references/staging-setup.md` |
