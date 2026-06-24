// Google Calendar integration per PRD 2.4.
//
// Reads free slots and writes booking events. If Google OAuth credentials
// are not configured, falls back to an in-memory mock calendar so the full
// booking flow can be demoed end-to-end without external setup.

import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { toMinutes } from '../core/businessHours.js';

const hasGoogleCreds = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);

// ── Mock store (used when no creds) ──────────────────────────────────────
const mockEvents = []; // { start: Date, end: Date, summary }

function getGoogleClient() {
  const oAuth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oAuth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth: oAuth2 });
}

// Convert a wall-clock time in a given IANA timezone to the correct UTC
// instant, accounting for DST. (Avoids pulling in a date library.)
function zonedTimeToUtc(year, month, day, hour, minute, tz) {
  const guess = new Date(Date.UTC(year, month, day, hour, minute));
  const asTz = new Date(guess.toLocaleString('en-US', { timeZone: tz }));
  const asUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() + (asUtc.getTime() - asTz.getTime()));
}

// The Y-M-D calendar date, `d` days from now, as seen in the practice timezone.
function zonedDateParts(tz, daysFromNow, now) {
  const base = new Date(now.getTime() + daysFromNow * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).formatToParts(base);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    year: +get('year'),
    month: +get('month') - 1,
    day: +get('day'),
    weekday: get('weekday').toLowerCase().slice(0, 3)
  };
}

// Build candidate slot start-times for the next N days within bookable hours,
// anchored to the practice's local timezone.
function buildCandidateSlots(config, daysAhead = 7, now = new Date()) {
  const [openStr, closeStr] = config.bookableHours || ['08:00', '17:30'];
  const open = toMinutes(openStr);
  const close = toMinutes(closeStr);
  const dur = config.slotDurationMinutes || 30;
  const tz = config.businessHours.timezone || 'Europe/Berlin';

  const slots = [];
  for (let d = 0; d < daysAhead; d++) {
    const { year, month, day, weekday } = zonedDateParts(tz, d, now);
    if (!config.businessHours.days[weekday]) continue; // closed that day

    for (let min = open; min + dur <= close; min += dur) {
      const start = zonedTimeToUtc(year, month, day, Math.floor(min / 60), min % 60, tz);
      if (start <= now) continue; // no past slots
      const end = new Date(start.getTime() + dur * 60000);
      slots.push({ start, end });
    }
  }
  return slots;
}

async function getBusyIntervals(config, timeMin, timeMax) {
  if (!hasGoogleCreds()) {
    return mockEvents.map((e) => ({ start: e.start, end: e.end }));
  }
  const calendar = getGoogleClient();
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: config.googleCalendarId }]
    }
  });
  const busy = res.data.calendars[config.googleCalendarId]?.busy || [];
  return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

// Returns up to `count` available slots (PRD 2.3.1 step 6 → offer 3 options).
export async function getAvailableSlots(config, count = 3, now = new Date()) {
  const candidates = buildCandidateSlots(config, 7, now);
  if (!candidates.length) return [];

  const timeMin = candidates[0].start;
  const timeMax = candidates[candidates.length - 1].end;
  const busy = await getBusyIntervals(config, timeMin, timeMax);

  const free = candidates.filter((slot) => !busy.some((b) => overlaps(slot, b)));
  logger.info('Computed available slots', { candidates: candidates.length, free: free.length });
  return free.slice(0, count);
}

// Creates the booking event (PRD 2.4: name, phone, age, reason in description).
export async function createBooking(config, slot, patient) {
  const description = [
    `Patient: ${patient.name}`,
    `Phone: ${patient.phone}`,
    `Age/DOB: ${patient.age}`,
    `Reason: ${patient.reason}`
  ].join('\n');

  const event = {
    summary: `Appointment — ${patient.name}`,
    description,
    start: { dateTime: slot.start.toISOString(), timeZone: config.businessHours.timezone },
    end: { dateTime: slot.end.toISOString(), timeZone: config.businessHours.timezone }
  };

  if (!hasGoogleCreds()) {
    mockEvents.push({ start: slot.start, end: slot.end, summary: event.summary });
    logger.warn('Google Calendar not configured — booking stored in mock calendar', { summary: event.summary });
    return { id: `mock-${mockEvents.length}`, ...event };
  }

  const calendar = getGoogleClient();
  const res = await calendar.events.insert({
    calendarId: config.googleCalendarId,
    requestBody: event
  });
  logger.info('Created Google Calendar event', { id: res.data.id });
  return res.data;
}
