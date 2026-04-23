CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  license_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_configs (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crawl_cache (
  cache_key TEXT NOT NULL,
  date DATE NOT NULL,
  scan_type TEXT NOT NULL,
  result JSONB NOT NULL,
  status_code INT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (cache_key, date)
);

CREATE TABLE IF NOT EXISTS scan_results (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  scan_type TEXT NOT NULL,
  query_key TEXT NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proxy_health (
  proxy_id TEXT PRIMARY KEY,
  total_requests INT DEFAULT 0,
  total_failures INT DEFAULT 0,
  consecutive_failures INT DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  disabled_until TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id SERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL,
  total_queries INT NOT NULL,
  successful INT NOT NULL,
  failed INT NOT NULL,
  skipped INT NOT NULL,
  duration_ms INT NOT NULL,
  proxy_stats JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
CREATE INDEX IF NOT EXISTS idx_scan_results_user_date ON scan_results(user_id, date);
CREATE INDEX IF NOT EXISTS idx_crawl_cache_date ON crawl_cache(date);
