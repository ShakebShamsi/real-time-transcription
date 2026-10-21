# Procucev Voice — Real-time Speech-to-Text

A complete full-stack implementation of the Procucev AI Tech Hiring Assignment.

The app captures speech from a browser microphone, streams audio to Gemini Live transcription, shows interim and finalized text while the user speaks, automatically saves finalized segments to a relational SQLite database, and provides a history dashboard with search and CRUD operations. The interface also includes browser-based text-to-speech playback and `.txt` export.

## Assignment requirements covered

| Assignment requirement | Implementation |
| --- | --- |
| Real-time speech-to-text | Browser microphone audio is resampled to mono, 16 kHz PCM and streamed over WebSocket to Gemini Live. |
| Multilingual / Hindi + English code-switching | Model is configured with automatic language detection (`languageCodes: []`). |
| Live updates | Interim hypotheses appear immediately; finalized segments are added to the transcript. |
| Store transcriptions in a database | SQLite relational table, saved in `server/data/transcriptions.sqlite`. Final speech segments are appended as they arrive. |
| History dashboard | Recent sessions, word and duration stats, search, transcript detail view. |
| CRUD operations | Create session, read/list, edit title and contents, append segments, delete records. |
| Text-to-speech | Optional playback with the browser's built-in `SpeechSynthesis` API; no additional API key. |
| Environment and docs | `.env.example`, installation instructions, API reference, setup troubleshooting. |

## Technology choices

- **Frontend:** React 19, Vite, Lucide React, custom responsive CSS.
- **Backend:** Node.js, Express, WebSocket (`ws`).
- **Speech recognition:** Gemini Live API model `gemini-3.5-transcribe-live`.
- **Database:** SQLite via `better-sqlite3`. The database is relational and local, so no separate DB server is required.
- **Text-to-speech:** Browser `SpeechSynthesis` API (optional; supported voices vary by operating system/browser).

The assignment sheet mentions a self-deployed open-source speech-to-text service as one option and Gemini as another example. This implementation selects Gemini Live for low-latency streaming and automatic language/code-switch detection. Gemini is a hosted API, not a self-deployed open-source model; an open-source/local STT alternative can be added behind the same WebSocket interface if required.

## Requirements

1. Node.js **22 LTS recommended** and npm.
2. A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey), with access to the Live API model configured in `server/.env`.
3. A current Chrome or Edge browser. The page must be served from `localhost` or HTTPS for microphone access.

> **API pricing/quotas:** Do not assume all model usage is free. Check the current [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) and your account's model availability before using it.

## 1. Install the project

Extract the project ZIP, open a terminal in the project folder, then run:

```bash
npm install
```

The root `package.json` uses npm workspaces to install the client, server and root development dependencies together.

If you prefer separate installs:

```bash
npm install --workspace server
npm install --workspace client
```

## 2. Configure `.env`

Copy the example environment file:

**Windows PowerShell**

```powershell
Copy-Item server/.env.example server/.env
```

**macOS/Linux**

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and replace the placeholder with your real API key:

```dotenv
GEMINI_API_KEY=your_actual_gemini_api_key
GEMINI_LIVE_MODEL=gemini-3.5-transcribe-live
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
DATABASE_PATH=./data/transcriptions.sqlite
```

Never add the real API key to frontend code, commit it to Git, or share the filled-in `.env`. The API key remains on the Node server; the browser connects to the server WebSocket, which proxies audio and transcript events to Gemini.

`server/.env` is ignored by Git. The `.env.example` file contains placeholders only.

## 3. Start the app

From the project root:

```bash
npm run dev
```

This starts:

- Frontend: <http://localhost:5173>
- Backend REST API: <http://localhost:4000>
- Backend health check: <http://localhost:4000/api/health>

Open the frontend URL and permit microphone access when the browser asks. Press **Start recording**, speak in Hindi, English, or naturally mixed Hinglish, then press **Stop recording**. Finalized transcript segments save automatically to the history page.

Run one service at a time when debugging:

```bash
npm run dev:server
npm run dev:client
```

Build the frontend for production:

```bash
npm run build
```

Check server syntax and build the client:

```bash
npm run check
```

The Vite frontend and API are separate in development. For deployment, host the frontend and API separately or configure a production static-file server, then set `CLIENT_ORIGIN` and the frontend API URL accordingly.

## 4. Database

On first server startup, the API creates this file automatically:

```text
server/data/transcriptions.sqlite
```

Table: `transcriptions`

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | INTEGER, primary key | Unique transcription id |
| `title` | TEXT | Editable title |
| `content` | TEXT | Final transcript text |
| `language` | TEXT | Currently `auto`; model language detection is automatic |
| `duration_seconds` | INTEGER | Recorded duration |
| `created_at` | TEXT | Creation timestamp in UTC |
| `updated_at` | TEXT | Last update timestamp in UTC |

The UI can edit the title or transcript text, export text files and delete individual entries. The local database is excluded from Git so personal transcript data is not accidentally committed.

## 5. REST API reference

Base URL: `http://localhost:4000`

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Backend, database and transcription configuration status |
| `GET` | `/api/stats` | Session count, total audio seconds and total word estimate |
| `GET` | `/api/transcriptions?limit=200&search=hello` | List or search transcripts |
| `POST` | `/api/transcriptions` | Create a transcription session |
| `GET` | `/api/transcriptions/:id` | Get a specific transcript |
| `POST` | `/api/transcriptions/:id/append` | Append a finalized segment to a session |
| `PATCH` | `/api/transcriptions/:id` | Edit `title`, `content`, `language` or `durationSeconds` |
| `DELETE` | `/api/transcriptions/:id` | Delete a session |

Example create request:

```bash
curl -X POST http://localhost:4000/api/transcriptions \
  -H "Content-Type: application/json" \
  -d '{"title":"Meeting notes","content":"Namaste everyone","language":"auto","durationSeconds":12}'
```

Example append request:

```bash
curl -X POST http://localhost:4000/api/transcriptions/1/append \
  -H "Content-Type: application/json" \
  -d '{"text":"The meeting starts at ten AM."}'
```

The real-time WebSocket endpoint is `ws://localhost:4000/ws/transcription`. The frontend streams JSON messages containing base64-encoded PCM audio at 16 kHz. The server sends `ready`, `interim`, `final`, and `error` events.

## 6. Project structure

```text
procucev-speech-to-text/
├── README.md
├── package.json                  # npm workspaces and root scripts
├── .gitignore
├── server/
│   ├── .env.example              # Copy to .env and add your key
│   ├── package.json              # API dependencies and server scripts
│   ├── data/
│   │   └── .gitkeep              # SQLite file is created here on first run
│   └── src/
│       ├── index.js              # Express app, REST API and lifecycle
│       ├── db.js                 # SQLite schema and database operations
│       ├── realtime.js           # WebSocket ↔ Gemini Live proxy
│       └── routes/
│           └── transcriptions.js # CRUD API routes and validation
└── client/
    ├── package.json              # React/Vite dependencies
    ├── index.html                # App entry HTML and metadata
    ├── vite.config.js            # Vite development server config
    └── src/
        ├── main.jsx              # React bootstrap
        ├── App.jsx               # Pages, live mic capture and CRUD UI
        ├── styles.css            # Responsive interface styles
        └── lib/
            └── api.js            # Typed-by-convention REST/WebSocket client
```

## 7. Important integration details

### Real-time audio path

1. The browser requests microphone permission.
2. Web Audio captures mono audio and downsamples it to 16 kHz PCM signed 16-bit little-endian samples.
3. The client converts each short PCM chunk to base64 and sends it over the app WebSocket.
4. The server forwards chunks to Gemini Live with MIME type `audio/pcm;rate=16000`.
5. Interim transcript events update the preview. Final transcript events are displayed and appended to the SQLite record.
6. On Stop, the app signals the end of the audio stream, waits briefly for finalization, stores duration/title and refreshes the history.

### Browser text-to-speech

On a transcript detail, **Read aloud** calls `window.speechSynthesis`. Voice availability and quality depend on the browser and installed OS language packs. It is an optional convenience, not part of the transcription pipeline, and does not require an additional external API.

## 8. Troubleshooting

**The settings page says “Missing / invalid” for the Gemini key**

- Make sure `server/.env` exists, not only `.env.example`.
- Remove any placeholder text and paste a valid key after `GEMINI_API_KEY=`.
- Restart the server after environment changes.
- Check your Google AI Studio model access, current API limits and quota.

**The server runs, but the WebSocket fails**

- Confirm the frontend is at `http://localhost:5173` and the backend is at `http://localhost:4000`.
- Open `http://localhost:4000/api/health` and verify that `transcriptionConfigured` is `true`.
- Check the server terminal for the upstream Gemini connection error.

**The browser cannot access the microphone**

- Use Chrome or Edge on `localhost` or HTTPS.
- Allow microphone access in the address bar and Windows privacy settings.
- Close other applications using the microphone, then reload the page.

**The SQLite package fails to install on Windows**

- Use the recommended Node.js 22 LTS release and rerun `npm install` from the project root.
- If npm reports an unsupported binary or native build error, delete `node_modules` and `package-lock.json` (if present), install Node.js 22 LTS, and run `npm install` again.

**A recording has no saved text**

- The app only persists finalized transcript segments. Very short clips, silence, or poor mic audio may produce no final transcript.
- Speak a full sentence, pause briefly so the model can finalize it, then stop the recording.

**TTS does not play in Hindi**

- Browser speech-synthesis voices are system-dependent. Install or enable Hindi voices in your operating system/browser, or use an available English voice for mixed-script content.

## 9. API documentation

- Gemini Live transcription: <https://ai.google.dev/gemini-api/docs/live-api/live-transcribe>
- Gemini API keys: <https://aistudio.google.com/apikey>
- Gemini API pricing: <https://ai.google.dev/gemini-api/docs/pricing>
- Web Audio API: <https://developer.mozilla.org/docs/Web/API/Web_Audio_API>
- SpeechSynthesis: <https://developer.mozilla.org/docs/Web/API/SpeechSynthesis>

## 10. Security before deployment

This assignment demo does not implement user authentication. Keep it local for evaluation. Before a public deployment, add authentication/authorization, API rate limits, usage limits, secure CORS configuration and transcript retention controls. See [`docs/API.md`](docs/API.md) for endpoint schemas, [`docs/FILE_GUIDE.md`](docs/FILE_GUIDE.md) for the responsibility of each source file, and [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) for all installed libraries and browser APIs.

## 11. Submission checklist

- [ ] Run `npm install` successfully.
- [ ] Create `server/.env` and add a valid Gemini API key.
- [ ] Run `npm run dev` and confirm the API health endpoint is online.
- [ ] Test a Hindi sentence and a sentence mixing Hindi and English.
- [ ] Confirm finalized words save automatically into history.
- [ ] Test search, edit, export, read aloud and delete.
- [ ] Do not include your real API key or personal SQLite database in the submitted ZIP/Git repository.

---

**Note:** API access, available model ids, limits and pricing are controlled by Google and can change. The UI and CRUD API run locally; live transcription requires valid access to the configured Gemini model.

### Optional frontend `.env`

Local defaults already point at port 4000, so a frontend env file is not needed for a normal run. If your API is hosted at a different origin, copy `client/.env.example` to `client/.env`, set `VITE_API_BASE_URL` and `VITE_WS_BASE_URL` to the API base origin, then rebuild the Vite app. These are public endpoint URLs only; never put `GEMINI_API_KEY` in a `VITE_` variable.
