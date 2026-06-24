// Twilio voice webhooks wiring the IVR + AI booking flow (PRD 2.2–2.3).
//
// Endpoints (configure your Twilio number's Voice webhook to POST /voice/incoming):
//   POST /voice/incoming?practiceId=demo-practice   → entry point
//   POST /voice/menu?practiceId=...                  → handles IVR keypress
//   POST /voice/agent?practiceId=...                 → AI conversation turns

import express from 'express';
import { loadClientConfig } from '../config/configLoader.js';
import { isWithinBusinessHours } from '../core/businessHours.js';
import { createSession, advance, openingLine } from '../core/conversation.js';
import { say, ivrMenu, dial } from '../services/twilioService.js';
import { logger } from '../utils/logger.js';

export const voiceRouter = express.Router();

// In-memory session store keyed by Twilio CallSid. For multi-instance
// production deployments swap this for Redis.
const sessions = new Map();

const q = (req, key, def) => req.query[key] || def;
const baseUrl = () => process.env.PUBLIC_BASE_URL || '';

function agentAction(practiceId) {
  return `${baseUrl()}/voice/agent?practiceId=${encodeURIComponent(practiceId)}`;
}

// Entry point.
voiceRouter.post('/incoming', (req, res) => {
  const practiceId = q(req, 'practiceId', 'demo-practice');
  let config;
  try {
    config = loadClientConfig(practiceId);
  } catch (err) {
    logger.error('Unknown practiceId on incoming call', { practiceId });
    return res.type('text/xml').send(say('Sorry, this number is not configured. Goodbye.', { hangup: true }));
  }

  const open = isWithinBusinessHours(config);
  const { language, agentVoice } = config;

  if (open) {
    // PRD 2.2.1 — present IVR menu during business hours.
    const text = `Thank you for calling ${config.practiceName}. To speak with our team, press 1. To book an appointment automatically, press 2.`;
    return res
      .type('text/xml')
      .send(ivrMenu(text, { action: `${baseUrl()}/voice/menu?practiceId=${practiceId}`, voice: agentVoice, language }));
  }

  // PRD 2.2.2 — after hours: straight to the AI agent.
  return startAgent(req, res, config, /* afterHours */ true);
});

// IVR keypress handler.
voiceRouter.post('/menu', (req, res) => {
  const practiceId = q(req, 'practiceId', 'demo-practice');
  const config = loadClientConfig(practiceId);
  const digit = req.body.Digits;
  const timedOut = q(req, 'timeout', null);

  if (digit === '1') {
    return res.type('text/xml').send(dial(config.forwardingNumber));
  }
  if (digit === '2') {
    return startAgent(req, res, config, false);
  }
  // No selection: repeat once, then route to AI (PRD 2.2.1).
  if (!timedOut) {
    const text = 'Sorry, I didn\'t get that. To speak with our team, press 1. To book an appointment automatically, press 2.';
    return res
      .type('text/xml')
      .send(ivrMenu(text, { action: `${baseUrl()}/voice/menu?practiceId=${practiceId}`, voice: config.agentVoice, language: config.language }));
  }
  return startAgent(req, res, config, false);
});

function startAgent(req, res, config, afterHours) {
  const callSid = req.body.CallSid || `local-${Date.now()}`;
  const callerId = req.body.From || null;
  const session = createSession({ config, callerId, afterHours });
  sessions.set(callSid, session);

  return res.type('text/xml').send(
    say(openingLine(session), {
      gatherAction: agentAction(config.practiceId),
      voice: config.agentVoice,
      language: config.language
    })
  );
}

// AI conversation turns.
voiceRouter.post('/agent', async (req, res) => {
  const practiceId = q(req, 'practiceId', 'demo-practice');
  const config = loadClientConfig(practiceId);
  const callSid = req.body.CallSid;
  const session = sessions.get(callSid);

  if (!session) {
    return res.type('text/xml').send(say('Sorry, your session has expired. Please call again.', { hangup: true }));
  }

  const speech = req.body.SpeechResult || '';

  // Silence detection (PRD 2.3.3): empty speech result → end gracefully.
  if (!speech.trim()) {
    session.silence = (session.silence || 0) + 1;
    if (session.silence >= 1) {
      sessions.delete(callSid);
      return res.type('text/xml').send(say('I didn\'t hear anything, so I\'ll end the call now. Goodbye.', { hangup: true }));
    }
  } else {
    session.silence = 0;
  }

  const { reply, done } = await advance(session, speech);
  if (done) sessions.delete(callSid);

  return res.type('text/xml').send(
    say(reply, {
      gatherAction: done ? undefined : agentAction(practiceId),
      voice: config.agentVoice,
      language: config.language,
      hangup: done
    })
  );
});
