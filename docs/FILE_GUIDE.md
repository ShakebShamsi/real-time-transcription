# File-by-file guide

## Root

- `package.json` — npm workspaces and convenience scripts to install, run and build the app.
- `.gitignore` — prevents dependency folders, production build output, `.env` secrets and local SQLite data from being committed.
- `README.md` — full installation steps, environment configuration, architecture, stack, database schema, API overview and troubleshooting.

## Frontend: `client/`

- `.env.example` — optional Vite API/WS base URLs for when the backend is not running on `localhost:4000`.
- `package.json` — React, React DOM, Vite, React plugin and Lucide icons.
- `index.html` — browser entry point, page metadata and font imports.
- `vite.config.js` — configures the local development server on port `5173`.
- `src/main.jsx` — mounts the React application and loads global styles.
- `src/App.jsx` — Studio, History and Settings pages; microphone capture and PCM downsampling; WebSocket lifecycle; interim/final text; automatic save; search; editing; deletion; export; and speech playback.
- `src/lib/api.js` — REST API methods and WebSocket URL construction. No secret keys belong here.
- `src/styles.css` — responsive application styles and motion states.

## Backend: `server/`

- `.env.example` — placeholder environment values. Copy it to `.env` locally and set `GEMINI_API_KEY`.
- `package.json` — Express, Google Gen AI SDK, SQLite driver, WebSocket, CORS, security headers, request logging and dev runner.
- `data/.gitkeep` — ensures the folder exists in source control; the `.sqlite` database is generated automatically and ignored by Git.
- `src/index.js` — loads environment settings, starts Express, exposes health/stats routes and REST endpoints, configures CORS, and starts the HTTP/WebSocket server.
- `src/db.js` — initializes the SQLite table/index and implements create, list/search, read, append, update, delete and statistics operations.
- `src/realtime.js` — receives browser audio over WebSocket, connects to Gemini Live on the server, forwards audio, and relays interim/final transcript events without exposing the long-lived API key to the browser.
- `src/routes/transcriptions.js` — REST CRUD routes, input validation, and HTTP error handling for transcription resources.

## Documentation: `docs/`

- `API.md` — method-by-method REST and WebSocket request/response reference.
- `FILE_GUIDE.md` — this guide, mapping each file to its responsibility.
