# API reference

Base URL: `http://localhost:4000`

All request and response bodies use JSON unless a route returns HTTP `204 No Content`.

## Health and statistics

### `GET /api/health`

Returns API status, database type, the configured live model, whether a Gemini key is configured, and the current server time. The response never includes the API key.

```json
{
  "status": "ok",
  "service": "procucev-speech-to-text-api",
  "database": "sqlite",
  "transcriptionConfigured": true,
  "model": "gemini-3.5-transcribe-live",
  "time": "2026-10-21T12:00:00.000Z"
}
```

### `GET /api/stats`

```json
{
  "data": {
    "total": 3,
    "totalSeconds": 185,
    "words": 142
  }
}
```

`words` is calculated from the current transcript contents. Counts update after create, append, edit and delete operations.

## Transcriptions

### `GET /api/transcriptions?limit=200&search=meeting`

Lists the most recently updated records. `search` is optional and matches title or content. `limit` defaults to 100 and is capped at 200.

Response:

```json
{
  "data": [
    {
      "id": 1,
      "title": "Meeting starts at ten",
      "content": "The meeting starts at ten AM.",
      "language": "auto",
      "durationSeconds": 18,
      "createdAt": "2026-10-21T06:30:00.000Z",
      "updatedAt": "2026-10-21T06:30:18.000Z",
      "wordCount": 6
    }
  ],
  "total": 1
}
```

### `POST /api/transcriptions`

Creates a session; the frontend creates this when recording starts so finalized speech segments have a stable record id.

Request fields are optional unless otherwise noted:

```json
{
  "title": "Meeting notes",
  "content": "",
  "language": "auto",
  "durationSeconds": 0
}
```

Constraints: `title` up to 160 characters; `content` up to 1,000,000 characters; `language` up to 40 characters; `durationSeconds` must be non-negative.

Returns HTTP `201` and `{ "data": <transcription> }`.

### `GET /api/transcriptions/:id`

Returns the record under `data`. An invalid id returns `400`; a missing record returns `404`.

### `POST /api/transcriptions/:id/append`

Atomically appends a non-empty finalized speech segment to a session. This is separate from editing the complete record so concurrent segments don't overwrite the whole transcript.

Request:

```json
{ "text": "The meeting starts at ten AM." }
```

Returns the updated record under `data`.

### `PATCH /api/transcriptions/:id`

Updates any subset of the following fields: `title`, `content`, `language`, `durationSeconds`.

```json
{
  "title": "Edited meeting title",
  "content": "Corrected transcript text.",
  "durationSeconds": 20
}
```

The title cannot be empty. Returns the updated record under `data`.

### `DELETE /api/transcriptions/:id`

Deletes the record and returns HTTP `204`. Returns `404` if no record exists.

## Real-time WebSocket

Connect to `ws://localhost:4000/ws/transcription`. HTTPS deployment must use `wss://`.

Audio is captured by the browser and encoded as base64 from raw signed 16-bit little-endian PCM, mono, 16 kHz. The server forwards it as Gemini audio with MIME type `audio/pcm;rate=16000`.

### Client → server

```json
{ "type": "audio", "data": "BASE64_PCM_CHUNK" }
```

Send this on stop to signal the end of microphone input:

```json
{ "type": "end" }
```

### Server → client

- `ready`: upstream live session is connected.
- `interim`: temporary partial transcription text, for live preview only.
- `final`: finalized segment; the frontend shows it and persists it via the append REST route.
- `stream-ended`: end of audio stream has been signaled.
- `error`: configuration, connection or audio-stream error.
- `upstream-closed`: the provider connection closed unexpectedly.

Example final event:

```json
{ "type": "final", "text": "आज हम React application के बारे में बात करेंगे." }
```

## Error shape

REST errors use a stable, human-readable shape:

```json
{ "error": "Transcription not found." }
```

Common status codes are `400` for invalid input, `403` for a blocked CORS origin, `404` for a missing record, and `500` for an unexpected server error.

## Security note

This is a hiring-assignment demo without user authentication. Keep it local for evaluation. Before public deployment, add authentication/authorization, rate limits, secure origin policy, usage limits, and data-retention controls; do not expose an unauthenticated transcript CRUD API to the public internet.
