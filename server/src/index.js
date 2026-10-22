import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import transcriptionsRouter from './routes/transcriptions.js';
import { attachRealtime } from './realtime.js';
import * as database from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load server/.env
dotenv.config({
  path: path.resolve(__dirname, '..', '.env'),
});

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 4000;

// React + Vite production build directory
const clientDistPath = path.resolve(
  __dirname,
  '../../client/dist'
);

// Allowed frontend origins for local development and production
const allowedOrigins = (
  process.env.CLIENT_ORIGIN || 'http://localhost:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },
    contentSecurityPolicy: false,
  })
);


app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error('This origin is not allowed by CORS.')
      );
    },
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// --------------------
// Health check
// --------------------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'procucev-speech-to-text-api',
    database: 'sqlite',
    transcriptionConfigured: Boolean(
      process.env.GEMINI_API_KEY &&
      !process.env.GEMINI_API_KEY.startsWith('replace_')
    ),
    model:
      process.env.GEMINI_LIVE_MODEL ||
      'gemini-3.5-transcribe-live',
    time: new Date().toISOString(),
  });
});

// --------------------
// Statistics API
// --------------------

app.get('/api/stats', (_req, res) => {
  res.json({
    data: database.getStats(),
  });
});

// --------------------
// Transcription CRUD API
// --------------------

app.use('/api/transcriptions', transcriptionsRouter);

// --------------------
// Serve React + Vite frontend
// --------------------

app.use(express.static(clientDistPath));

app.get('/', (_req, res) => {
  res.sendFile(
    path.join(clientDistPath, 'index.html')
  );
});

// --------------------
// API error handling
// --------------------

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Request body contains invalid JSON.',
    });
  }

  if (
    error?.message ===
    'This origin is not allowed by CORS.'
  ) {
    return res.status(403).json({
      error: error.message,
    });
  }

  console.error('[api] Unhandled request error:', error);

  return res.status(500).json({
    error: 'Unexpected server error.',
  });
});

// --------------------
// Real-time WebSocket
// --------------------

attachRealtime(server);

// --------------------
// Start server
// --------------------

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Procucev application started');
  console.log(`  Port         ${PORT}`);
  console.log(`  Frontend     ${clientDistPath}`);
  console.log(`  Health check /api/health`);
  console.log(
    `  Gemini model ${
      process.env.GEMINI_LIVE_MODEL ||
      'gemini-3.5-transcribe-live'
    }`
  );

  if (
    !process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY.startsWith('replace_')
  ) {
    console.warn(
      '  ! GEMINI_API_KEY is missing or still a placeholder.'
    );
  }
});

// --------------------
// Graceful shutdown
// --------------------

function shutDown(signal) {
  console.log(
    `\n${signal} received; shutting down gracefully...`
  );

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => shutDown('SIGINT'));
process.on('SIGTERM', () => shutDown('SIGTERM'));
