// Express server hosting the Twilio voice webhooks (PRD Stage 1 MVP).

import 'dotenv/config';
import express from 'express';
import { voiceRouter } from './routes/voice.js';
import { listClients } from './config/configLoader.js';
import { logger } from './utils/logger.js';

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, clients: listClients() }));

app.use('/voice', voiceRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info(`Dental receptionist agent listening on :${port}`);
  logger.info('Configured clients', { clients: listClients() });
  logger.info('Point your Twilio number Voice webhook to POST {PUBLIC_BASE_URL}/voice/incoming?practiceId=<id>');
});
