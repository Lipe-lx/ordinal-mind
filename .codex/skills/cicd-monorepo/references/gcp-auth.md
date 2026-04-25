# Autenticação GCP via Service Account

## 1. Criar o Service Account

```bash
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions Deploy"
```

## 2. Conceder permissões necessárias

```bash
PROJECT_ID=$(gcloud config get-value project)
SA_EMAIL="github-actions@${PROJECT_ID}.iam.gserviceaccount.com"

# Cloud Run
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin"

# Container Registry
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.admin"

# Cloud Build
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudbuild.builds.editor"

# Service Account User (necessário para o Cloud Run usar a SA)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser"
```

## 3. Gerar a chave JSON

```bash
gcloud iam service-accounts keys create key.json \
  --iam-account="${SA_EMAIL}"
```

## 4. Adicionar ao GitHub Secrets

Copie o conteúdo do `key.json` e adicione como secret `GCP_SA_KEY` no repositório:

**Settings → Secrets and variables → Actions → New repository secret**

```
Nome:  GCP_SA_KEY
Valor: (cole o conteúdo inteiro do key.json)
```

Adicione também:
```
Nome:  GCP_PROJECT_ID
Valor: seu-project-id-aqui
```

> ⚠️ Delete o arquivo `key.json` localmente após adicionar ao GitHub. Nunca commite esse arquivo.

## 5. Verificar no workflow

```yaml
- id: auth
  uses: google-github-actions/auth@v2
  with:
    credentials_json: ${{ secrets.GCP_SA_KEY }}

- uses: google-github-actions/setup-gcloud@v2
```
