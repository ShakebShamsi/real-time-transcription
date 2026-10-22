```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databasePathFromEnv =
  process.env.DATABASE_PATH || './data/transcriptions.sqlite';

const databasePath = path.isAbsolute(databasePathFromEnv)
  ? databasePathFromEnv
  : path.resolve(__dirname, '..', databasePathFromEnv);

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS transcriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'Untitled transcription',
    content TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'auto',
    duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_transcriptions_updated_at
    ON transcriptions(updated_at DESC);
`);

const toApiRecord = (row) => {
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    language: row.language,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    wordCount: row.content.trim()
      ? row.content.trim().split(/\s+/u).length
      : 0,
  };
};

const findById = db.prepare(
  'SELECT * FROM transcriptions WHERE id = ?'
);

const insertTranscription = db.prepare(`
  INSERT INTO transcriptions (
    title, content, language, duration_seconds, created_at, updated_at
  )
  VALUES (@title, @content, @language, @durationSeconds, @now, @now)
`);

const updateTranscription = db.prepare(`
  UPDATE transcriptions
  SET title = @title,
      content = @content,
      language = @language,
      duration_seconds = @durationSeconds,
      updated_at = @now
  WHERE id = @id
`);

const appendTranscription = db.prepare(`
  UPDATE transcriptions
  SET content = CASE
        WHEN TRIM(content) = '' THEN @segment
        ELSE content || ' ' || @segment
      END,
      updated_at = @now
  WHERE id = @id
`);

const deleteTranscription = db.prepare(
  'DELETE FROM transcriptions WHERE id = ?'
);

function createTranscription(input = {}) {
  const now = new Date().toISOString();

  const result = insertTranscription.run({
    title: input.title || 'Untitled transcription',
    content: input.content || '',
    language: input.language || 'auto',
    durationSeconds: Number.isFinite(input.durationSeconds)
      ? input.durationSeconds
      : 0,
    now,
  });

  return toApiRecord(findById.get(result.lastInsertRowid));
}

function listTranscriptions({ search = '', limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);

  let rows;

  if (search.trim()) {
    const pattern = `%${search.trim()}%`;

    rows = db.prepare(`
      SELECT * FROM transcriptions
      WHERE title LIKE ? OR content LIKE ?
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(pattern, pattern, safeLimit);
  } else {
    rows = db.prepare(`
      SELECT * FROM transcriptions
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(safeLimit);
  }

  return rows.map(toApiRecord);
}

function getTranscription(id) {
  return toApiRecord(findById.get(id));
}

function appendToTranscription(id, segment) {
  const now = new Date().toISOString();

  const result = appendTranscription.run({
    id,
    segment: segment.trim(),
    now,
  });

  return result.changes ? getTranscription(id) : null;
}

function patchTranscription(id, patch) {
  const current = findById.get(id);

  if (!current) return null;

  const data = {
    id,
    title: patch.title !== undefined ? patch.title : current.title,
    content: patch.content !== undefined ? patch.content : current.content,
    language: patch.language !== undefined
      ? patch.language
      : current.language,
    durationSeconds: patch.durationSeconds !== undefined
      ? patch.durationSeconds
      : current.duration_seconds,
    now: new Date().toISOString(),
  };

  updateTranscription.run(data);

  return getTranscription(id);
}

function removeTranscription(id) {
  return deleteTranscription.run(id).changes > 0;
}

function getStats() {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(duration_seconds), 0) AS total_seconds
    FROM transcriptions
  `).get();

  const contents = db.prepare(
    'SELECT content FROM transcriptions'
  ).all();

  const words = contents.reduce((total, item) => {
    const content = item.content.trim();

    return total + (content ? content.split(/\s+/u).length : 0);
  }, 0);

  return {
    total: row.total,
    totalSeconds: row.total_seconds,
    words,
  };
}

export {
  createTranscription,
  listTranscriptions,
  getTranscription,
  appendToTranscription,
  patchTranscription,
  removeTranscription,
  getStats,
};
```
