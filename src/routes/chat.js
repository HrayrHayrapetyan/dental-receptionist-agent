// Text-chat front door for the booking agent (web widget / hosted page).
//
// Drives the SAME conversation engine as the phone flow — only the transport
// differs. The widget POSTs here once per user message.
//
//   POST /chat   { practiceId, sessionId?, message? }
//     → { sessionId, reply, done }
//
// First call (no sessionId) returns a new sessionId + the opening greeting and
// ignores any message. Subsequent calls advance the conversation.

import express from 'express';
import crypto from 'crypto';
import { loadClientConfig } from '../config/configLoader.js';
import { createSession, advance, openingLine } from '../core/conversation.js';
import { logger } from '../utils/logger.js';

export const chatRouter = express.Router();

// In-memory session store keyed by sessionId. Swap for Redis in production.
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

// Periodically drop stale sessions so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastSeen > SESSION_TTL_MS) sessions.delete(id);
  }
}, 5 * 60 * 1000).unref();

chatRouter.post('/', async (req, res) => {
  const { practiceId = 'demo-practice', sessionId, message } = req.body || {};

  let config;
  try {
    config = loadClientConfig(practiceId);
  } catch {
    return res.status(404).json({ error: `Unknown practiceId "${practiceId}"` });
  }

  // New conversation → mint a session and return the greeting.
  if (!sessionId || !sessions.has(sessionId)) {
    const id = crypto.randomUUID();
    // Web chat books at any time, so use the neutral (non-after-hours) greeting.
    const session = createSession({ config, callerId: null, afterHours: false, channel: 'chat' });
    session.lastSeen = Date.now();
    sessions.set(id, session);
    return res.json({ sessionId: id, reply: openingLine(session), done: false });
  }

  const session = sessions.get(sessionId);
  session.lastSeen = Date.now();

  try {
    const { reply, done } = await advance(session, String(message || ''));
    if (done) sessions.delete(sessionId);
    return res.json({ sessionId, reply, done });
  } catch (err) {
    logger.error('Chat advance failed', { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
});
