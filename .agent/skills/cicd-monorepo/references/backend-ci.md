# CI do Backend por Linguagem

## Node.js / TypeScript

```yaml
- run: cd backend && npm ci
- run: cd backend && npm run lint
- run: cd backend && npm run test
- run: cd backend && npm run build
```

Ferramentas recomendadas: ESLint, Jest ou Vitest, tsc --noEmit para type-check.

---

## Python

```yaml
- uses: actions/setup-python@v5
  with:
    python-version: '3.11'
- run: cd backend && pip install -r requirements.txt
- run: cd backend && flake8 .
- run: cd backend && pytest
```

Ferramentas recomendadas: flake8 ou ruff (lint), pytest, mypy (type-check).

---

## Go

```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.22'
- run: cd backend && go vet ./...
- run: cd backend && go test ./...
- run: cd backend && go build ./...
```

---

## Java / Kotlin (Maven)

```yaml
- uses: actions/setup-java@v4
  with:
    java-version: '21'
    distribution: 'temurin'
- run: cd backend && mvn verify
```

---

## Java / Kotlin (Gradle)

```yaml
- uses: actions/setup-java@v4
  with:
    java-version: '21'
    distribution: 'temurin'
- run: cd backend && ./gradlew test build
```

---

## Rust

```yaml
- run: cd backend && cargo fmt --check
- run: cd backend && cargo clippy -- -D warnings
- run: cd backend && cargo test
- run: cd backend && cargo build --release
```
