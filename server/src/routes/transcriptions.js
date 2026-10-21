const express = require('express');
const db = require('../db');

const router = express.Router();
const MAX_CONTENT_LENGTH = 1_000_000;

function parseId(raw) {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validateText(value, field, maxLength) {
  if (typeof value !== 'string') return `${field} must be a string.`;
  if (value.length > maxLength) return `${field} must be ${maxLength.toLocaleString()} characters or fewer.`;
  return null;
}

router.get('/', (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const limit = req.query.limit;
  const items = db.listTranscriptions({ search, limit });
  res.json({ data: items, total: items.length });
});

router.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid transcription id.' });
  const item = db.getTranscription(id);
  if (!item) return res.status(404).json({ error: 'Transcription not found.' });
  return res.json({ data: item });
});

router.post('/', (req, res) => {
  const { title, content, language, durationSeconds } = req.body || {};
  for (const [value, field, max] of [
    [title, 'title', 160],
    [content, 'content', MAX_CONTENT_LENGTH],
    [language, 'language', 40],
  ]) {
    if (value !== undefined) {
      const error = validateText(value, field, max);
      if (error) return res.status(400).json({ error });
    }
  }
  if (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds < 0)) {
    return res.status(400).json({ error: 'durationSeconds must be a non-negative number.' });
  }
  const item = db.createTranscription({ title, content, language, durationSeconds });
  return res.status(201).json({ data: item });
});

router.post('/:id/append', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid transcription id.' });
  const segment = req.body?.text;
  if (typeof segment !== 'string' || !segment.trim()) {
    return res.status(400).json({ error: 'text must be a non-empty string.' });
  }
  const error = validateText(segment, 'text', 20_000);
  if (error) return res.status(400).json({ error });
  const item = db.appendToTranscription(id, segment);
  if (!item) return res.status(404).json({ error: 'Transcription not found.' });
  return res.json({ data: item });
});

router.patch('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid transcription id.' });
  const { title, content, language, durationSeconds } = req.body || {};
  if (![title, content, language, durationSeconds].some((value) => value !== undefined)) {
    return res.status(400).json({ error: 'Provide at least one field to update.' });
  }
  for (const [value, field, max] of [
    [title, 'title', 160],
    [content, 'content', MAX_CONTENT_LENGTH],
    [language, 'language', 40],
  ]) {
    if (value !== undefined) {
      const error = validateText(value, field, max);
      if (error) return res.status(400).json({ error });
    }
  }
  if (title !== undefined && !title.trim()) {
    return res.status(400).json({ error: 'title cannot be empty.' });
  }
  if (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds < 0)) {
    return res.status(400).json({ error: 'durationSeconds must be a non-negative number.' });
  }
  const item = db.patchTranscription(id, {
    ...(title !== undefined ? { title: title.trim() } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds: Math.floor(durationSeconds) } : {}),
  });
  if (!item) return res.status(404).json({ error: 'Transcription not found.' });
  return res.json({ data: item });
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid transcription id.' });
  if (!db.removeTranscription(id)) return res.status(404).json({ error: 'Transcription not found.' });
  return res.status(204).end();
});

module.exports = router;
