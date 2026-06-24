// TwiML helpers for the Twilio voice webhooks (PRD 2.6).

import twilio from 'twilio';

const { VoiceResponse } = twilio.twiml;

// A <Gather> that captures the caller's speech and posts it to `action`.
export function say(text, { gatherAction, voice = 'Polly.Vicki', language = 'en-US', hangup = false } = {}) {
  const vr = new VoiceResponse();
  if (gatherAction && !hangup) {
    const gather = vr.gather({
      input: 'speech',
      action: gatherAction,
      method: 'POST',
      speechTimeout: 'auto',
      language
    });
    gather.say({ voice, language }, text);
    // If the caller says nothing, re-post to the same action so we can
    // detect silence and end gracefully (PRD 2.3.3 voicemail handling).
    vr.redirect({ method: 'POST' }, gatherAction);
  } else {
    vr.say({ voice, language }, text);
    if (hangup) vr.hangup();
  }
  return vr.toString();
}

// The business-hours IVR menu (PRD 2.2.1).
export function ivrMenu(text, { action, voice = 'Polly.Vicki', language = 'en-US' }) {
  const vr = new VoiceResponse();
  const gather = vr.gather({ input: 'dtmf', numDigits: 1, action, method: 'POST', timeout: 5 });
  gather.say({ voice, language }, text);
  // No selection after timeout → repeat once via redirect handled by caller.
  vr.redirect({ method: 'POST' }, action + (action.includes('?') ? '&' : '?') + 'timeout=1');
  return vr.toString();
}

export function dial(number) {
  const vr = new VoiceResponse();
  vr.dial(number);
  return vr.toString();
}
