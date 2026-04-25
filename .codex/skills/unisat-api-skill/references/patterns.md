# Padroes de Integracao UniSat (perfil atual)

## 1. Cliente minimo e robusto

- Um endpoint principal (`/v1/indexer/inscription/info/{id}`)
- Retry apenas para `429`
- Backoff exponencial curto
- Timeout defensivo

## 2. Degradacao graciosa obrigatoria

Se UniSat falhar:
- manter timeline factual (ordinals + mempool + overlays)
- retornar Chronicle parcial valido
- registrar diagnostico sem quebrar UX

## 3. Throttle no plano free

Referencial seguro:
- ate 5 req/s (free)
- usar atraso entre requests sequenciais em loops

## 4. Nao promover UniSat para papel que nao e dela no produto

- nao usar como fonte principal de traits
- nao usar para rarity rank da colecao
- nao depender de attributes para montar o card

## 5. Checklist de review rapido

- [ ] erro UniSat nao bloqueia endpoint `/api/chronicle`
- [ ] `source_catalog` identifica UniSat como indexador complementar
- [ ] nao ha mensagem no UI afirmando que rank vem da UniSat
- [ ] logs de diagnostico deixam claro quando UniSat foi ignorada/indisponivel
