"""The found-songs database: real recordings of catalog tunes, with where each tune is played.

One SQLite file (data/found.sqlite, never committed). `videos` caches what a source says
about a recording; `found` holds labelled sections of it, one row per tune heard.
"""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "found"
DATABASE = ROOT / "data" / "found.sqlite"

SCHEMA = """
create table if not exists searches (
  query text primary key,
  harvester text not null,
  results integer not null,
  searched_at text not null
);
create table if not exists videos (
  id text primary key,               -- YouTube id
  title text,
  channel text,
  duration_s real,
  licence text,                      -- as the source states it; null when unstated
  album text,                        -- music metadata of auto-generated "Topic" uploads
  artist text,
  description text,
  chapters text,                     -- JSON [{start_time, end_time, title}]
  upload_date text,
  status text not null,              -- ok | unavailable
  fetched_at text not null
);
create table if not exists found (
  id integer primary key,
  video_id text not null references videos(id),
  start_s real not null,
  end_s real not null,
  tune_id integer not null,
  name text not null,                -- the tune as the source names it
  position integer,                  -- 1-based place in the set; null when unknown
  set_size integer,
  label_source text not null,        -- album | chapters | description | title
  recording_id integer,              -- The Session recording, for album labels
  track integer,
  confidence real not null,          -- prior on the label being right, before review
  verified text,                     -- null | yes | no
  audio text,                        -- path under data/found once downloaded
  notes text,
  added_at text not null,
  unique (video_id, start_s, tune_id)
);
create index if not exists found_tune on found(tune_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: Path = DATABASE) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("pragma journal_mode = wal")
    db.executescript(SCHEMA)
    return db
