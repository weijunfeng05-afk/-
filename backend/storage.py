import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


SCHEMA = '''
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, jd_text TEXT NOT NULL, requirements TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, confirmed INTEGER NOT NULL DEFAULT 0,
 created_at REAL NOT NULL, updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS resumes (
 id TEXT PRIMARY KEY, file_hash TEXT UNIQUE NOT NULL, filename TEXT NOT NULL, file_path TEXT NOT NULL,
 text_blocks TEXT, parsed_json TEXT, parse_version TEXT, name TEXT, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS job_resumes (
 job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE, resume_id TEXT REFERENCES resumes(id) ON DELETE CASCADE,
 PRIMARY KEY(job_id,resume_id));
CREATE TABLE IF NOT EXISTS analysis_tasks (
 id TEXT PRIMARY KEY, task_type TEXT NOT NULL, input_key TEXT NOT NULL,
 job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE, resume_id TEXT REFERENCES resumes(id) ON DELETE CASCADE,
 payload TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL DEFAULT '等待中',
 attempt INTEGER NOT NULL DEFAULT 1, token TEXT, lease_until REAL, error TEXT, output TEXT,
 created_at REAL NOT NULL, updated_at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS tasks_queue ON analysis_tasks(status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_dedup ON analysis_tasks(input_key) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS match_results (
 id TEXT PRIMARY KEY, task_id TEXT UNIQUE REFERENCES analysis_tasks(id) ON DELETE CASCADE,
 job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE, resume_id TEXT REFERENCES resumes(id) ON DELETE CASCADE,
 job_version INTEGER NOT NULL, parse_version TEXT NOT NULL, config_version INTEGER NOT NULL,
 model TEXT NOT NULL, prompt_version TEXT NOT NULL, scoring_version TEXT NOT NULL,
 input_snapshot TEXT NOT NULL, result TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS model_configs (
 id INTEGER PRIMARY KEY CHECK(id=1), base_url TEXT NOT NULL, model TEXT NOT NULL,
 encrypted_key TEXT NOT NULL, config_version INTEGER NOT NULL);
'''


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        (self.directory / 'files').mkdir(exist_ok=True)
        self.path = self.directory / 'app.sqlite3'
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript(SCHEMA)

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=10000')
        try:
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def one(self, sql, params=()):
        with self.connect() as db:
            row = db.execute(sql, params).fetchone()
            return dict(row) if row else None

    def all(self, sql, params=()):
        with self.connect() as db:
            return [dict(r) for r in db.execute(sql, params).fetchall()]
