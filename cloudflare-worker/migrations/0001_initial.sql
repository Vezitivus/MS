PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL UNIQUE,
  image TEXT NOT NULL DEFAULT '',
  image_public_id TEXT NOT NULL DEFAULT '',
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  code_normalized TEXT NOT NULL UNIQUE,
  best_count INTEGER NOT NULL DEFAULT 12 CHECK (best_count >= 1),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  admin_pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  status TEXT NOT NULL DEFAULT 'active',
  joined_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (season_id, player_id),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_at TEXT NOT NULL,
  registration_open_at TEXT,
  registration_close_at TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (activity_id, player_id),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (activity_id, player_id),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  session_type TEXT NOT NULL CHECK (session_type IN ('player', 'admin')),
  subject_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memberships_season ON memberships(season_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_player ON memberships(player_id, status);
CREATE INDEX IF NOT EXISTS idx_activities_season ON activities(season_id, start_at);
CREATE INDEX IF NOT EXISTS idx_registrations_activity ON registrations(activity_id, status);
CREATE INDEX IF NOT EXISTS idx_registrations_player ON registrations(player_id, status);
CREATE INDEX IF NOT EXISTS idx_results_season ON results(season_id, player_id);
CREATE INDEX IF NOT EXISTS idx_results_activity ON results(activity_id, player_id);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(session_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
