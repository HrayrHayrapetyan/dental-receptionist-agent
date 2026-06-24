# AI Dental Receptionist Agent — Stage 1 MVP

An AI voice receptionist for dental practices. It answers inbound calls, routes
them (IVR during business hours, straight to the AI agent after hours), conducts
a natural booking conversation, writes the appointment to Google Calendar, and
emails the dentist a booking summary.

Built to the **Stage 1 MVP** scope of the PRD (`AI_Dental_Receptionist_PRD.docx`).

## What's implemented (Stage 1)

- ✅ Inbound call handling + IVR routing (Twilio) — PRD 2.2
- ✅ Business-hours logic (per-client config, timezone-aware) — PRD 2.2 / 2.7
- ✅ 10-step AI booking conversation with re-prompts & edge cases — PRD 2.3
- ✅ Caller-ID phone pre-fill + confirm/replace — PRD 2.3.2
- ✅ Google Calendar slot lookup + event creation — PRD 2.4
- ✅ Email notification to the dentist — PRD 2.5
- ✅ Per-client JSON configuration — PRD 2.7
- ✅ Claude (`claude-sonnet-4-6`) NLU with deterministic fallback — PRD 2.9
- ✅ **Terminal simulator** to test the full flow with zero credentials

Out of scope (Stage 2): cancellation/reschedule, SMS/WhatsApp reminders, web
widget, FAQ KB, multi-language, CRM.

## Architecture

```
src/
  server.js              Express app + Twilio webhooks
  routes/voice.js        /voice/incoming, /voice/menu, /voice/agent (TwiML)
  core/
    businessHours.js     open/closed decision (timezone-aware)
    conversation.js      the 10-step booking state machine (transport-agnostic)
  services/
    anthropicService.js  Claude field extraction (+ regex fallback)
    calendarService.js   Google Calendar read/write (+ in-memory mock)
    emailService.js      Nodemailer (+ console fallback)
    twilioService.js     TwiML builders
  config/configLoader.js per-client config loader
  simulator/cli.js       terminal driver for the same engine
config/clients/*.json    one file per onboarded practice
```

The **same conversation engine** powers both the phone and the simulator, so what
you test in the terminal is exactly what callers experience.

## Quick start (no credentials needed)

```bash
cd ~/Desktop/dental-receptionist-agent
npm install
npm run simulate            # walk through a full booking in your terminal
```

Every external service degrades gracefully when its keys are missing:
- **No `ANTHROPIC_API_KEY`** → deterministic regex-based understanding
- **No Google creds** → in-memory mock calendar (slots + bookings still work)
- **No SMTP** → the notification email is printed to the console

So you get a complete, demoable booking flow out of the box.

### Simulator options

```bash
npm run simulate                                   # after-hours, demo-practice
npm run simulate -- --hours                         # business-hours flow
npm run simulate -- --practice demo-practice --caller +4915112345678
```

## Going live

1. Copy `.env.example` → `.env` and fill in the keys you have.
2. Start the server: `npm start` (default port 3000).
3. Expose it publicly (e.g. `ngrok http 3000`) and set `PUBLIC_BASE_URL`.
4. In the Twilio console, set your number's **Voice webhook** to:
   `POST {PUBLIC_BASE_URL}/voice/incoming?practiceId=demo-practice`
5. Call the number.

### Google Calendar setup
Create an OAuth 2.0 client, authorize the practice calendar once, and put the
resulting refresh token in `GOOGLE_REFRESH_TOKEN`. Set `googleCalendarId` in the
client config (use `primary` or the calendar's ID).

### Email setup
Any SMTP provider works (SendGrid, Gmail app password, etc.). Set `SMTP_*` and
`EMAIL_FROM`; recipient is the client config's `notificationEmail`.

## Deploy to Render (one-click Blueprint)

This repo ships a `render.yaml` Blueprint.

1. Push the repo to GitHub (already done).
2. In [Render](https://render.com): **New → Blueprint** → connect this repo.
3. Render reads `render.yaml`, creates the web service, and prompts for the
   secret env vars (`ANTHROPIC_API_KEY`, `TWILIO_*`, `SMTP_*`, `GOOGLE_*`).
   Leave any blank to use that service's built-in fallback.
4. Deploy. Your service is at `https://dental-receptionist-agent.onrender.com`.
5. Verify: open `…/health` → `{"ok":true,...}`.
6. Point each clinic's Twilio number Voice webhook to
   `https://dental-receptionist-agent.onrender.com/voice/incoming?practiceId=<id>`.

> The free plan sleeps after inactivity (first call may lag ~30s while it wakes).
> Use the **starter** plan for an always-on production number.

## Onboarding a new practice (PRD 2.7)

Drop a new file in `config/clients/<practiceId>.json`:

```json
{
  "practiceId": "smile-koeln",
  "practiceName": "Smile Köln",
  "businessHours": { "timezone": "Europe/Berlin",
    "days": { "mon": ["08:00","18:00"], "tue": ["08:00","18:00"],
              "wed": ["08:00","18:00"], "thu": ["08:00","18:00"],
              "fri": ["08:00","14:00"], "sat": null, "sun": null } },
  "bookableHours": ["08:00","17:30"],
  "slotDurationMinutes": 30,
  "forwardingNumber": "+49221...",
  "googleCalendarId": "primary",
  "notificationEmail": "owner@smile-koeln.de",
  "agentVoice": "Polly.Vicki",
  "language": "de-DE",
  "callRecording": false
}
```

Then point a Twilio number at `/voice/incoming?practiceId=smile-koeln`.

## Notes & next steps

- **GDPR** (PRD §4): a signed DPA is required per client before go-live — this is
  a legal step, not a code change. Flag before first deployment.
- For multi-instance production, replace the in-memory session `Map` in
  `routes/voice.js` with Redis.
- German voice prompts: the engine text is currently English; the voice/language
  is selectable per client. Localizing the prompt strings is the natural Stage-1.1
  follow-up for the Cologne pilot.
```
