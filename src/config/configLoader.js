// Loads per-client configuration from config/clients/<practiceId>.json.
// Per PRD section 2.7, every practice is onboarded as a simple JSON config.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENTS_DIR = path.resolve(__dirname, '../../config/clients');

const cache = new Map();

export function loadClientConfig(practiceId) {
  if (cache.has(practiceId)) return cache.get(practiceId);

  const file = path.join(CLIENTS_DIR, `${practiceId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No config found for practiceId "${practiceId}" (${file})`);
  }

  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  validate(cfg);
  cache.set(practiceId, cfg);
  logger.info('Loaded client config', { practiceId, practiceName: cfg.practiceName });
  return cfg;
}

export function listClients() {
  if (!fs.existsSync(CLIENTS_DIR)) return [];
  return fs
    .readdirSync(CLIENTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

function validate(cfg) {
  const required = ['practiceId', 'practiceName', 'businessHours', 'slotDurationMinutes', 'googleCalendarId', 'notificationEmail'];
  for (const key of required) {
    if (cfg[key] === undefined || cfg[key] === null) {
      throw new Error(`Client config missing required field: ${key}`);
    }
  }
}
