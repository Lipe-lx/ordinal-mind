# Configurando Ambiente de Staging

## Estratégia de branches com staging

```
feature/* → develop → master
               ↓            ↓
           staging       produção
```

O ambiente de staging é acionado por push na branch `develop`.

---

## Staging no Cloudflare Pages

O Cloudflare Pages cria automaticamente preview URLs por branch. Basta configurar no dashboard:

- **Production branch**: `master`
- **Preview branches**: `develop` (e opcionalmente `feature/*`)

Cada push no `develop` gera uma URL como:
`https://develop.seu-projeto.pages.dev`

Não é necessário criar um workflow separado — o Cloudflare cuida disso nativamente.

---

## Staging no Cloud Run

Criar um serviço separado no Cloud Run para staging:

```yaml
# .github/workflows/cd-backend-staging.yml
name: CD - Backend (Staging)

on:
  push:
    branches: [develop]
    paths:
      - 'backend/**'

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - id: auth
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Build e push imagem de staging
        run: |
          gcloud builds submit backend/ \
            --tag gcr.io/${{ secrets.GCP_PROJECT_ID }}/backend-staging:${{ github.sha }}

      - name: Deploy no Cloud Run (staging)
        run: |
          gcloud run deploy backend-staging \
            --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/backend-staging:${{ github.sha }} \
            --region us-central1 \
            --platform managed \
            --allow-unauthenticated
```

Isso cria um serviço `backend-staging` separado do `backend` de produção.

---

## Variáveis de ambiente por ambiente

Use secrets diferentes para staging e produção:

| Secret               | Staging               | Produção            |
|----------------------|-----------------------|---------------------|
| `DATABASE_URL`       | `DATABASE_URL_STAGING`| `DATABASE_URL_PROD` |
| `API_KEY`            | `API_KEY_STAGING`     | `API_KEY_PROD`      |

No workflow, referencie o secret correto conforme a branch.
