// Conversation engine implementing the 10-step booking flow (PRD 2.3).
//
// Transport-agnostic: both the Twilio voice route and the local CLI simulator
// drive the same state machine. Each call to `advance()` consumes one caller
// utterance and returns the agent's next reply plus whether the call is over.

import { extract } from '../services/anthropicService.js';
import { getAvailableSlots, createBooking } from '../services/calendarService.js';
import { sendBookingNotification } from '../services/emailService.js';
import { logger } from '../utils/logger.js';

export const STATES = {
  GREET: 'GREET',
  ASK_NAME: 'ASK_NAME',
  ASK_AGE: 'ASK_AGE',
  CONFIRM_PHONE: 'CONFIRM_PHONE',
  ASK_REASON: 'ASK_REASON',
  OFFER_SLOTS: 'OFFER_SLOTS',
  CONFIRM_BOOKING: 'CONFIRM_BOOKING',
  ENDED: 'ENDED'
};

export function createSession({ config, callerId, afterHours = false, channel = 'voice' }) {
  return {
    config,
    callerId,
    afterHours,
    channel, // 'voice' (phone) | 'chat' (web widget)
    state: STATES.GREET,
    patient: { name: null, age: null, phone: callerId || null, reason: null },
    options: [],
    chosenSlot: null,
    reprompts: 0,
    done: false
  };
}

// The first thing the agent says when the AI flow starts (PRD 2.2.2 / 2.3.1).
export function openingLine(session) {
  const name = session.config.practiceName;
  if (session.channel === 'chat') {
    return `Hi! Welcome to ${name}. I can book an appointment for you right here. Would you like to book an appointment?`;
  }
  if (session.afterHours) {
    return `You've reached ${name}. Our office is currently closed, but I can help you book an appointment right now. Let's get started. Would you like to book an appointment?`;
  }
  return `Thank you for calling ${name}. I can book an appointment for you. Would you like to book an appointment?`;
}

function fmtSlot(slot, tz) {
  return slot.start.toLocaleString('en-GB', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Advance the conversation by one turn. Returns { reply, done }.
export async function advance(session, utterance) {
  const tz = session.config.businessHours.timezone;

  switch (session.state) {
    case STATES.GREET: {
      const { value } = await extract('yesno', utterance);
      if (value === 'no') {
        session.state = STATES.ENDED;
        session.done = true;
        return { reply: 'No problem. Thank you for calling, and take care.', done: true };
      }
      // Treat anything not-clearly-no as a yes (caller phoned a dentist).
      session.state = STATES.ASK_NAME;
      return { reply: 'Great. May I have your full name, please?', done: false };
    }

    case STATES.ASK_NAME: {
      const { value } = await extract('name', utterance);
      if (!value) return reprompt(session, 'Sorry, I didn\'t catch your name. Could you say your full name?');
      session.patient.name = value;
      session.state = STATES.ASK_AGE;
      return { reply: `Thank you, ${value}. What is your age or date of birth?`, done: false };
    }

    case STATES.ASK_AGE: {
      const { value } = await extract('age', utterance);
      if (!value) return reprompt(session, 'Could you tell me your age or date of birth?');
      session.patient.age = value;
      session.state = STATES.CONFIRM_PHONE;
      // Phone: confirm caller ID (voice) or ask outright (chat / no caller ID).
      if (!session.callerId) {
        return { reply: 'Thanks. What is the best phone number to reach you?', done: false };
      }
      return {
        reply: `Thanks. I have your phone number as ${session.callerId}. Is that the best number to reach you, or would you like to give a different one?`,
        done: false
      };
    }

    case STATES.CONFIRM_PHONE: {
      // No caller ID (chat): the reply IS the phone number.
      if (!session.callerId) {
        const digits = utterance.replace(/[^\d+]/g, '');
        if (digits.replace(/\D/g, '').length < 7) {
          return reprompt(session, 'Could you give me a phone number we can reach you on?');
        }
        session.patient.phone = digits;
        session.state = STATES.ASK_REASON;
        return { reply: 'Got it. Briefly, what is the reason for your visit? For example a toothache, a cleaning, or a consultation.', done: false };
      }
      const r = await extract('phoneConfirm', utterance);
      if (r.confirmed === false && r.phone) {
        session.patient.phone = r.phone;
      } else if (r.confirmed === false && !r.phone) {
        return reprompt(session, 'Sure — what number would you like us to use?');
      } else if (r.confirmed === null) {
        return reprompt(session, 'Sorry, is the number I read correct, or would you like to give another one?');
      }
      session.state = STATES.ASK_REASON;
      return { reply: 'Got it. Briefly, what is the reason for your visit? For example a toothache, a cleaning, or a consultation.', done: false };
    }

    case STATES.ASK_REASON: {
      const { value } = await extract('reason', utterance);
      if (!value) return reprompt(session, 'Could you briefly describe the reason for your visit?');
      session.patient.reason = value;
      return offerSlots(session, tz);
    }

    case STATES.OFFER_SLOTS: {
      const r = await extract('slotChoice', utterance, { options: session.options.map((s) => fmtSlot(s, tz)) });
      if (r.none) {
        session.state = STATES.ENDED;
        session.done = true;
        return {
          reply: 'No problem. I\'ll pass your number to the practice so the team can call you back to find a better time. Thank you for calling.',
          done: true
        };
      }
      if (!r.index || r.index < 1 || r.index > session.options.length) {
        return reprompt(session, 'Which option works best — the first, second, or third?');
      }
      session.chosenSlot = session.options[r.index - 1];
      session.state = STATES.CONFIRM_BOOKING;
      return {
        reply:
          `Let me confirm: ${session.patient.name}, booking for "${session.patient.reason}" on ` +
          `${fmtSlot(session.chosenSlot, tz)}. We'll contact you at ${session.patient.phone}. Shall I book it?`,
        done: false
      };
    }

    case STATES.CONFIRM_BOOKING: {
      const { value } = await extract('yesno', utterance);
      if (value === 'no') {
        return offerSlots(session, tz, 'Okay, let\'s pick another time.');
      }
      // Finalize: create event + email (PRD steps 9-10).
      try {
        await createBooking(session.config, session.chosenSlot, session.patient);
        await sendBookingNotification(session.config, session.chosenSlot, session.patient);
      } catch (err) {
        logger.error('Booking finalization failed', { error: err.message });
        session.state = STATES.ENDED;
        session.done = true;
        return {
          reply: 'I\'m sorry, something went wrong while saving your booking. The team will call you back shortly. Thank you for calling.',
          done: true
        };
      }
      session.state = STATES.ENDED;
      session.done = true;
      const closer = session.channel === 'chat' ? 'Thanks for booking with us' : 'Thank you for calling';
      return {
        reply:
          `You're all booked for ${fmtSlot(session.chosenSlot, tz)}. We'll contact you if anything changes. ` +
          `${closer}, and have a great day!`,
        done: true
      };
    }

    default:
      session.done = true;
      return { reply: 'Thank you for calling. Goodbye.', done: true };
  }
}

async function offerSlots(session, tz, prefix = '') {
  const slots = await getAvailableSlots(session.config, 3);
  if (!slots.length) {
    session.state = STATES.ENDED;
    session.done = true;
    return {
      reply: 'I\'m sorry, I don\'t have any open slots right now. I\'ll pass your number to the practice for a callback. Thank you for calling.',
      done: true
    };
  }
  session.options = slots;
  session.state = STATES.OFFER_SLOTS;
  const list = slots.map((s, i) => `Option ${i + 1}: ${fmtSlot(s, tz)}`).join('. ');
  return { reply: `${prefix ? prefix + ' ' : ''}Here are the next available appointments. ${list}. Which would you like?`, done: false };
}

// Re-prompt once per PRD 2.3.3; after that, offer a callback and end.
function reprompt(session, message) {
  session.reprompts += 1;
  if (session.reprompts >= 2) {
    session.state = STATES.ENDED;
    session.done = true;
    return {
      reply: 'I\'m having trouble getting that. I\'ll have the team call you back during business hours. Thank you for calling.',
      done: true
    };
  }
  return { reply: message, done: false };
}
