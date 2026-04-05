-- Products: id is stable slug for cart / Stripe metadata
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  category_slug TEXT NOT NULL,
  category_label TEXT NOT NULL,
  image_count INTEGER NOT NULL DEFAULT 4,
  hero_image_url TEXT,
  badge TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_active_sort
  ON products (is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  starts_on TEXT NOT NULL,
  month_key TEXT NOT NULL,
  date_month_label TEXT NOT NULL,
  date_day INTEGER NOT NULL,
  date_year INTEGER NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  schedule_text TEXT NOT NULL,
  event_type TEXT NOT NULL,
  lead TEXT NOT NULL,
  extras_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_active_starts
  ON events (is_active, starts_on, sort_order);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions (expires_at);
