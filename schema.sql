-- Cloudflare D1 schema para o Labirinto de Fármacos
-- Aplicar com:
--   wrangler d1 execute labirinto-db --file=./schema.sql           (local)
--   wrangler d1 execute labirinto-db --remote --file=./schema.sql  (remoto)

CREATE TABLE IF NOT EXISTS quiz_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  disease TEXT NOT NULL,
  result TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS disease_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  disease TEXT NOT NULL UNIQUE,
  views INTEGER DEFAULT 0,
  quiz_completions INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quiz_results_disease ON quiz_results(disease);
CREATE INDEX IF NOT EXISTS idx_quiz_results_timestamp ON quiz_results(timestamp);
CREATE INDEX IF NOT EXISTS idx_page_views_page ON page_views(page);
CREATE INDEX IF NOT EXISTS idx_page_views_timestamp ON page_views(timestamp);
