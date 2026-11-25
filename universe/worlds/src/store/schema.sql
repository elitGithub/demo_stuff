CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  local_change_seq INTEGER NOT NULL DEFAULT 0 CHECK (local_change_seq >= 0)
);

INSERT OR IGNORE INTO sync_meta (id, local_change_seq) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  premise TEXT NOT NULL DEFAULT '',
  style_notes TEXT NOT NULL DEFAULT '',
  player_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
  scene_state_json TEXT NOT NULL,
  encounter_public_odds INTEGER NOT NULL DEFAULT 8 CHECK (encounter_public_odds >= 0),
  encounter_private_odds INTEGER NOT NULL DEFAULT 30 CHECK (encounter_private_odds >= 0),
  scribe_interval INTEGER NOT NULL DEFAULT 1 CHECK (scribe_interval >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slug TEXT NOT NULL CHECK (length(slug) > 0),
  scribe_subject_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  aliases_json TEXT NOT NULL DEFAULT '[]',
  is_player INTEGER NOT NULL DEFAULT 0 CHECK (is_player IN (0, 1)),
  tier TEXT NOT NULL CHECK (tier IN ('main', 'recurring')),
  model_override TEXT,
  persona TEXT NOT NULL DEFAULT '',
  voice_notes TEXT NOT NULL DEFAULT '',
  card_json TEXT NOT NULL DEFAULT '{}',
  avatar_token TEXT NOT NULL CHECK (avatar_token IN ('sage', 'rose', 'amber', 'slate', 'plum', 'teal', 'indigo', 'coral')),
  avatar_initials TEXT NOT NULL CHECK (length(trim(avatar_initials)) > 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_id, slug)
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  mode TEXT NOT NULL CHECK (mode IN ('normal', 'narrator', 'encounter')),
  raw_text TEXT NOT NULL,
  ooc_nudge TEXT,
  scene_number INTEGER NOT NULL CHECK (scene_number >= 1),
  witness_ids_json TEXT NOT NULL DEFAULT '[]',
  scene_state_before_json TEXT,
  scene_state_after_json TEXT,
  director_plan_json TEXT,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, seq)
);

CREATE TABLE IF NOT EXISTS beats (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq > 0),
  speaker_type TEXT NOT NULL CHECK (speaker_type IN ('narrator', 'character', 'player')),
  character_id TEXT REFERENCES characters(id) ON DELETE RESTRICT,
  speaker_name TEXT NOT NULL CHECK (length(trim(speaker_name)) > 0),
  text TEXT NOT NULL,
  witness_ids_json TEXT NOT NULL DEFAULT '[]',
  mind_packet_json TEXT,
  UNIQUE (turn_id, seq)
);

CREATE TABLE IF NOT EXISTS scribe_books (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  book_json TEXT NOT NULL,
  last_turn_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_turn_seq >= 0),
  dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('contradiction', 'secret_leak', 'name_mismatch')),
  subject_id TEXT,
  subject_name TEXT NOT NULL DEFAULT '',
  speaker_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
  fact_id TEXT,
  category TEXT,
  book_text TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
  quote TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'ruled', 'told')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spend_log (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN ('director', 'mind', 'composer', 'scribe', 'pedant', 'muse')),
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  prompt_chars INTEGER,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turns_campaign_seq ON turns (campaign_id, seq);
CREATE INDEX IF NOT EXISTS idx_beats_turn_seq ON beats (turn_id, seq);
CREATE INDEX IF NOT EXISTS idx_beats_character_id ON beats (character_id);
CREATE INDEX IF NOT EXISTS idx_findings_campaign_status ON findings (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_findings_campaign_created ON findings (campaign_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_spend_log_created_at ON spend_log (created_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_updated_at ON campaigns (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_characters_campaign_name ON characters (campaign_id, archived, name, id);
