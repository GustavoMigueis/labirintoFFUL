# Labirinto de Fármacos

Website educativo de farmacologia clínica desenvolvido no âmbito da unidade
curricular Seminário II (2025/2026) da **Faculdade de Farmácia da Universidade
de Lisboa**.

O site apresenta, para cada doença, uma introdução clínica e um **quiz
terapêutico** que devolve a recomendação farmacológica adequada ao perfil do
doente: fármacos de primeira linha, alternativas, terapêuticas a evitar,
posologia, monitorização e estilo de vida.

## Doenças cobertas

| Grupo | Doenças |
| --- | --- |
| Cardiovasculares | Hipertensão Arterial · Enfarte Agudo do Miocárdio · Insuficiência Cardíaca · Fibrilhação Auricular · Doença Arterial Periférica · Trombose Venosa Profunda |
| Respiratórias | Asma · DPOC |
| Metabólicas | Diabetes Mellitus tipo 2 · Hipotiroidismo |
| Saúde mental | Ansiedade · Depressão |

## Estrutura do repositório

```
.
├── index.html         # Site single-page (HTML + CSS + JS, sem build)
├── images/            # Imagens do site (servidas localmente ou via R2)
├── worker/
│   └── index.js       # Cloudflare Worker — API + R2 image proxy
├── schema.sql         # Schema D1 (quiz_results, page_views, disease_stats)
├── wrangler.toml      # Configuração Cloudflare (Worker + D1 + R2)
└── README.md
```

## Arquitetura

```
   Browser
      │
      │  HTML / JS / CSS  ────►  Cloudflare Workers (Assets)
      │
      │  POST /api/quiz-result, /api/page-view
      │  GET  /api/stats[, /:disease]      ───►  D1  (labirinto-db)
      │
      │  GET  /images/:filename             ───►  R2  (labirinto-images)
```

* **Cloudflare Worker** (`worker/index.js`) — serve a API REST e atua como
  proxy de imagens a partir do bucket R2.
* **D1** — guarda resultados de quizzes, page views e mantém uma tabela
  agregada `disease_stats` com contadores por doença.
* **R2** — armazena as imagens do site (bucket `labirinto-images`).
* **Workers Assets** — serve o `index.html` e o resto do conteúdo estático.

## Endpoints da API

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/quiz-result` | Guarda `{ disease, result }` em `quiz_results` e incrementa `disease_stats.quiz_completions`. |
| `POST` | `/api/page-view` | Guarda `{ page }` em `page_views` e incrementa `disease_stats.views`. |
| `GET` | `/api/stats` | Estatísticas agregadas de todas as doenças + totais globais. |
| `GET` | `/api/stats/:disease` | Estatísticas de uma doença específica + últimos 20 resultados. |
| `GET` | `/images/:filename` | Imagem do bucket R2, com cache `immutable` de 1 ano. |

Todas as respostas têm CORS aberto (`Access-Control-Allow-Origin: *`).

## Setup local (primeira vez)

```bash
# 1. Instalar Wrangler
npm install -g wrangler
wrangler login

# 2. Criar a base D1 e copiar o database_id devolvido para o wrangler.toml
wrangler d1 create labirinto-db

# 3. Aplicar o schema
wrangler d1 execute labirinto-db --remote --file=./schema.sql

# 4. Criar o bucket R2
wrangler r2 bucket create labirinto-images

# 5. Carregar as imagens para o R2
for f in images/*.png; do
  wrangler r2 object put "labirinto-images/$(basename $f)" --file="$f"
done

# 6. Deploy do Worker
wrangler deploy
```

## Desenvolvimento local

```bash
wrangler dev
# Worker disponível em http://127.0.0.1:8787
```

Em desenvolvimento local, podes apontar o site para outro Worker definindo
`window.LABIRINTO_API_BASE` antes de carregar o resto da página:

```html
<script>window.LABIRINTO_API_BASE = "https://labirinto-farmacos.dev.workers.dev";</script>
```

## Notas

* O conteúdo clínico é educacional. **Não substitui aconselhamento médico nem
  farmacêutico.**
* A integração com a API é tolerante a falhas: se o Worker estiver
  indisponível, o site continua a funcionar normalmente — apenas as métricas
  deixam de ser registadas.

---

Universidade de Lisboa · Faculdade de Farmácia · Seminário II · 2025/2026
