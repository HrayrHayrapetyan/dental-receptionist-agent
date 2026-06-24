// Claude-powered natural-language extraction per PRD 2.9 (claude-sonnet-4-6).
//
// The conversation engine asks one focused question at a time and uses Claude
// to extract the relevant field from a free-form spoken answer (handles "yeah
// that number's fine", "I'm 34", "it's a really bad toothache", etc.).
//
// If ANTHROPIC_API_KEY is not set, a deterministic regex-based fallback is
// used so the agent still functions for local demos.

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';

const hasKey = () => !!process.env.ANTHROPIC_API_KEY;
let client = null;
const getClient = () => (client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// Extract a single field from a user's utterance.
// `field` ∈ name | age | phoneConfirm | reason | yesno | slotChoice
export async function extract(field, utterance, context = {}) {
  if (!hasKey()) return fallbackExtract(field, utterance, context);

  const sys =
    'You extract a single structured value from a dental patient\'s spoken reply. ' +
    'Reply ONLY with compact JSON, no prose.';

  const instructions = {
    name: 'Extract the full name. Return {"value": "<full name>"} or {"value": null} if none given.',
    age: 'Extract age or date of birth. Return {"value": "<age or DOB as said>"} or {"value": null}.',
    reason: 'Summarize the reason for the dental visit in 1 short phrase. Return {"value": "<reason>"} or {"value": null}.',
    yesno: 'Decide if the reply is affirmative or negative. Return {"value": "yes"} or {"value": "no"} or {"value": null}.',
    phoneConfirm:
      'The caller was asked if their caller-ID number is correct. If they confirm it, return {"confirmed": true}. ' +
      'If they give a different number, return {"confirmed": false, "phone": "<number>"}. If unclear return {"confirmed": null}.',
    slotChoice:
      `The caller was offered these slots (1-indexed): ${JSON.stringify(context.options || [])}. ` +
      'Return {"index": <1-based number>} for their choice, or {"none": true} if none work, or {"index": null} if unclear.'
  };

  try {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 200,
      system: sys,
      messages: [{ role: 'user', content: `${instructions[field]}\n\nReply: "${utterance}"` }]
    });
    const text = res.content.find((c) => c.type === 'text')?.text || '{}';
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return json;
  } catch (err) {
    logger.error('Anthropic extract failed, using fallback', { field, error: err.message });
    return fallbackExtract(field, utterance, context);
  }
}

// ── Deterministic fallback ───────────────────────────────────────────────
function fallbackExtract(field, utterance, context = {}) {
  const u = (utterance || '').trim();
  const lower = u.toLowerCase();

  switch (field) {
    case 'name':
      return { value: u || null };
    case 'age': {
      const m = u.match(/\b(\d{1,3})\b/) || u.match(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/);
      return { value: m ? m[0] : u || null };
    }
    case 'reason':
      return { value: u || null };
    case 'yesno': {
      if (/\b(yes|yeah|yep|sure|correct|right|ok|okay|ja|genau)\b/.test(lower)) return { value: 'yes' };
      if (/\b(no|nope|nah|wrong|nein)\b/.test(lower)) return { value: 'no' };
      return { value: null };
    }
    case 'phoneConfirm': {
      const digits = u.replace(/[^\d+]/g, '');
      if (/\b(yes|yeah|correct|right|that'?s? (right|fine|correct)|ja)\b/.test(lower)) return { confirmed: true };
      if (digits.length >= 7) return { confirmed: false, phone: digits };
      if (/\b(no|different|another)\b/.test(lower)) return { confirmed: false, phone: null };
      return { confirmed: null };
    }
    case 'slotChoice': {
      const none = /\b(none|neither|no.*work|doesn'?t work|other)\b/.test(lower);
      if (none) return { none: true };
      const ordinals = { first: 1, second: 2, third: 3, '1st': 1, '2nd': 2, '3rd': 3, one: 1, two: 2, three: 3 };
      for (const [word, idx] of Object.entries(ordinals)) {
        if (lower.includes(word)) return { index: idx };
      }
      const m = lower.match(/\b([1-9])\b/);
      return { index: m ? parseInt(m[1], 10) : null };
    }
    default:
      return {};
  }
}
