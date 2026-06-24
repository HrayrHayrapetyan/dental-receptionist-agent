// Terminal simulator — drives the exact same conversation engine the phone
// uses, so you can test the full booking flow end-to-end with no Twilio,
// Google, or Anthropic credentials. (PRD demo enablement.)
//
//   npm run simulate                       # after-hours flow, demo-practice
//   npm run simulate -- --practice demo-practice --caller +4915112345678 --hours

import 'dotenv/config';
import readline from 'readline';
import { loadClientConfig } from '../config/configLoader.js';
import { createSession, advance, openingLine } from '../core/conversation.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  };
  return {
    practiceId: get('--practice', 'demo-practice'),
    caller: get('--caller', '+4915112345678'),
    afterHours: !args.includes('--hours') // default = after hours unless --hours passed
  };
}

async function main() {
  const { practiceId, caller, afterHours } = parseArgs();
  const config = loadClientConfig(practiceId);
  const session = createSession({ config, callerId: caller, afterHours });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log(`\n=== Simulating call to ${config.practiceName} ===`);
  console.log(`Caller ID: ${caller} | ${afterHours ? 'AFTER HOURS' : 'BUSINESS HOURS'}\n`);
  console.log(`Agent: ${openingLine(session)}`);

  while (!session.done) {
    const you = await ask('\nYou:   ');
    const { reply, done } = await advance(session, you);
    console.log(`Agent: ${reply}`);
    if (done) break;
  }

  console.log('\n=== Call ended ===\n');
  rl.close();
}

main().catch((err) => {
  console.error('Simulator error:', err);
  process.exit(1);
});
