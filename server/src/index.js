const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const http = require('node:http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const transcriptionsRouter = require('./routes/transcriptions');
const { attachRealtime } = require('./realtime');
const database = require('./db');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 4000;
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('This origin is not allowed by CORS.'));
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'procucev-speech-to-text-api',
    database: 'sqlite',
    transcriptionConfigured: Boolean(
      process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith('replace_')
    ),
    model: process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-transcribe-live',
    time: new Date().toISOString(),
  });
});

app.get('/api/stats', (_req, res) => {
  res.json({ data: database.getStats() });
});

app.use('/api/transcriptions', transcriptionsRouter);

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body contains invalid JSON.' });
  }
  if (error?.message === 'This origin is not allowed by CORS.') {
    return res.status(403).json({ error: error.message });
  }
  console.error('[api] Unhandled request error:', error);
  return res.status(500).json({ error: 'Unexpected server error.' });
});

attachRealtime(server);

server.listen(PORT, () => {
  console.log(`\n  Procucev API  http://localhost:${PORT}`);
  console.log(`  Health check http://localhost:${PORT}/api/health`);
  console.log(`  Gemini model ${process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-transcribe-live'}`);
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.startsWith('replace_')) {
    console.warn('  ! Add GEMINI_API_KEY to server/.env to enable microphone transcription.\n');
  }
});

function shutDown(signal) {
  console.log(`\n${signal} received; shutting down gracefully...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutDown('SIGINT'));
process.on('SIGTERM', () => shutDown('SIGTERM'));
