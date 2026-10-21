# Libraries and dependencies

You do not need to install each dependency manually. From the project root, run `npm install`; npm workspaces install dependencies declared in root, `client/package.json` and `server/package.json`.

## Frontend libraries

| Package | Purpose |
| --- | --- |
| `react` | Component-based UI |
| `react-dom` | Mount React to the browser DOM |
| `vite` | Development server and frontend build |
| `@vitejs/plugin-react` | React support for Vite |
| `lucide-react` | Icons throughout the dashboard |

## Backend libraries

| Package | Purpose |
| --- | --- |
| `express` | REST API and middleware |
| `@google/genai` | Node SDK for Gemini Live transcription |
| `ws` | Browser-to-server real-time audio WebSocket |
| `better-sqlite3` | Local SQLite relational database |
| `dotenv` | Read server configuration from `server/.env` |
| `cors` | Restrict browser API access to the configured frontend origin |
| `helmet` | Standard HTTP security headers |
| `morgan` | HTTP request logging for development |

## Development helpers

| Package | Purpose |
| --- | --- |
| `concurrently` | Run frontend and backend together from the root script |
| `nodemon` | Restart the API process when server source files change |

## Runtime/platform APIs (not npm dependencies)

- `navigator.mediaDevices.getUserMedia()` captures microphone audio.
- `AudioContext`, `MediaStreamAudioSourceNode`, and `ScriptProcessorNode` capture/resample audio to 16 kHz PCM. `ScriptProcessorNode` is used for a compact assignment demo; a production system could replace it with `AudioWorklet`.
- `WebSocket` streams audio and receives transcript events.
- `window.speechSynthesis` optionally reads saved text aloud using installed browser/OS voices.
