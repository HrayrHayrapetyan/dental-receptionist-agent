// Express server hosting the Twilio voice webhooks (PRD Stage 1 MVP).

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { voiceRouter } from './routes/voice.js';
import { chatRouter } from './routes/chat.js';
import { listClients } from './config/configLoader.js';
import { logger } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded
app.use(express.json());

// CORS — the widget runs on the clinic's own domain and calls back here.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Static assets: widget.js + the embeddable demo page.
app.use(express.static(path.resolve(__dirname, '../public')));

app.get('/health', (_req, res) => res.json({ ok: true, clients: listClients() }));

app.use('/voice', voiceRouter);
app.use('/chat', chatRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info(`Dental receptionist agent listening on :${port}`);
  logger.info('Configured clients', { clients: listClients() });
  logger.info('Point your Twilio number Voice webhook to POST {PUBLIC_BASE_URL}/voice/incoming?practiceId=<id>');
});
