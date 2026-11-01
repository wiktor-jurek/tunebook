"""The one home of the tune finder's data: labels, tune roles, datasets and runs in the app's Postgres
(schema `ml`, src/db/ml-schema.ts), audio in the private B2 bucket. Nothing here serves audio publicly.

Credentials come from the repo's .env: ML_DATABASE_URL (a role limited to the ml schema) and the B2_* keys.
Needs the `store` dependency group: uv sync --group store.

    from tunebook_ml import store
    path = store.audio(source)          # local copy, downloaded from B2 when missing

Audio keys mirror the local folders: ml/audio/youtube/<video>.<start>-<length>.wav (clips),
ml/audio/youtube/full/<video>.flac (whole sessions), ml/audio/album/<video>.<start>-<end>.ogg,
yue/train/<box>/<name>.ogg (YuE2, uploaded by yue/upload.sh).
    rows = store.segments(verified="yes")
"""

import hashlib
import os
import zlib
from functools import cache
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
CACHE = ML / "cache" / "store"
# Tunes newly listed in a benchmark go to training by this rule; listed tunes keep their role forever.
TRAIN_SHARE = 30


@cache
def env() -> dict[str, str]:
    values = dict(os.environ)
    path = ML.parent / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            name, sep, value = line.partition("=")
            if sep and not line.lstrip().startswith("#"):
                values.setdefault(name.strip(), value.strip().strip('"'))
    return values


@cache
def db():
    import psycopg
    from psycopg.rows import dict_row

    url = env().get("ML_DATABASE_URL")
    if not url:
        raise SystemExit("ML_DATABASE_URL is not set (the ml_writer role's connection string, in the repo's .env)")
    return psycopg.connect(url, row_factory=dict_row, autocommit=True)


@cache
def bucket():
    import boto3

    e = env()
    client = boto3.client("s3", endpoint_url=e["B2_S3_ENDPOINT"], region_name=e["B2_REGION"],
                          aws_access_key_id=e["B2_KEY_ID"], aws_secret_access_key=e["B2_APPLICATION_KEY"])
    return client, e["B2_BUCKET"]


def put_audio(path: Path, key: str) -> str:
    client, name = bucket()
    client.upload_file(str(path), name, key)
    return key


def audio(source: dict) -> Path:
    """A local copy of a source's audio, fetched from B2 once and kept under cache/store/."""
    key = source["storage_key"]
    if not key:
        raise FileNotFoundError(f"source {source['id']} has no audio in the bucket")
    local = CACHE / key
    if not local.exists():
        local.parent.mkdir(parents=True, exist_ok=True)
        client, name = bucket()
        client.download_file(name, key, str(local.with_suffix(local.suffix + ".part")))
        local.with_suffix(local.suffix + ".part").rename(local)
    return local


def segments(**where) -> list[dict]:
    """Segments joined with their source, filtered by equality on segment or source columns (e.g. kind="album")."""
    clauses, values = [], []
    for column, value in where.items():
        table = "s" if column in {"kind", "external_id", "status"} else "g"
        clauses.append(f"{table}.{column} = %s")
        values.append(value)
    query = ("select g.*, s.kind, s.external_id, s.title, s.channel, s.storage_key, s.duration_s as source_duration_s "
             "from ml.segments g join ml.sources s on s.id = g.source_id")
    if clauses:
        query += " where " + " and ".join(clauses)
    return db().execute(query + " order by g.id", values).fetchall()


def upsert_source(kind: str, external_id: str, storage_key: str | None = None, **fields) -> int:
    columns = ["kind", "external_id", "storage_key", *fields]
    values = [kind, external_id, storage_key, *fields.values()]
    # An existing storage key is kept when none is given (registering a source before its upload), and meta is
    # merged, so keys other tools added (lanes, set windows, prelabels) survive a re-import.
    updates = ", ".join([f"{c} = coalesce(ml.sources.meta, '{{}}'::jsonb) || excluded.meta" if c == "meta" else f"{c} = excluded.{c}" for c in fields]
                        + ["storage_key = coalesce(excluded.storage_key, ml.sources.storage_key)"])
    row = db().execute(
        f"insert into ml.sources ({', '.join(columns)}) values ({', '.join(['%s'] * len(columns))}) "
        f"on conflict (kind, external_id) do update set {updates}, updated_at = now() returning id", values).fetchone()
    return row["id"]


def upsert_segment(source_id: int, start_s: float, tune_id: int | None, **fields) -> int:
    if tune_id is None:  # the unique key treats unnamed tunes as all different, so match them by hand
        found = db().execute("select id from ml.segments where source_id = %s and start_s = %s and tune_id is null order by id limit 1",
                             (source_id, start_s)).fetchone()
        if found:
            if fields:
                db().execute(f"update ml.segments set {', '.join(f'{c} = %s' for c in fields)}, updated_at = now() where id = %s",
                             [*fields.values(), found["id"]])
            return found["id"]
    columns = ["source_id", "start_s", "tune_id", *fields]
    values = [source_id, start_s, tune_id, *fields.values()]
    updates = ", ".join(f"{c} = excluded.{c}" for c in fields)
    row = db().execute(
        f"insert into ml.segments ({', '.join(columns)}) values ({', '.join(['%s'] * len(columns))}) "
        f"on conflict (source_id, start_s, tune_id) do update set {updates}, updated_at = now() returning id", values).fetchone()
    return row["id"]


def roles(listed: set[int] | None = None) -> dict[int, str]:
    """Every tune's role ("eval" or "train"). Tunes in `listed` without one get it now, by the fixed rule,
    and keep it: a tune is never moved from eval to train."""
    known = {row["tune_id"]: row["role"] for row in db().execute("select tune_id, role from ml.tune_roles")}
    for tune in sorted((listed or set()) - set(known)):
        role = "train" if zlib.crc32(f"bench{tune}".encode()) % 100 < TRAIN_SHARE else "eval"
        db().execute("insert into ml.tune_roles (tune_id, role, reason) values (%s, %s, %s) on conflict do nothing",
                     (tune, role, f"listed in a benchmark; crc32 rule ({TRAIN_SHARE}% train)"))
        known[tune] = role
    return known


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()
