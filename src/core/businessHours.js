// Business-hours logic per PRD 2.2. Decides whether a call lands during
// open hours (→ IVR prompt) or after hours (→ straight to AI agent).

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Returns the local wall-clock time in the practice timezone as { day, minutes }.
function localNow(timezone, now = new Date()) {
  // Intl gives us a reliable timezone-aware breakdown without extra deps.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekday = get('weekday').toLowerCase().slice(0, 3); // "mon"
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0; // some runtimes emit 24 for midnight
  const minute = parseInt(get('minute'), 10);

  return { day: weekday, minutes: hour * 60 + minute };
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function isWithinBusinessHours(config, now = new Date()) {
  const tz = config.businessHours.timezone || 'Europe/Berlin';
  const { day, minutes } = localNow(tz, now);
  const window = config.businessHours.days[day];
  if (!window) return false; // closed that day
  const [open, close] = window;
  return minutes >= toMinutes(open) && minutes < toMinutes(close);
}

export { DAY_KEYS, toMinutes };
