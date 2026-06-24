// Minimal structured logger. Keeps console output readable in dev and
// greppable in production log aggregators.

const ts = () => new Date().toISOString();

const fmt = (level, msg, meta) => {
  const base = `[${ts()}] ${level.toUpperCase()} ${msg}`;
  if (meta && Object.keys(meta).length) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
};

export const logger = {
  info: (msg, meta) => console.log(fmt('info', msg, meta)),
  warn: (msg, meta) => console.warn(fmt('warn', msg, meta)),
  error: (msg, meta) => console.error(fmt('error', msg, meta)),
  debug: (msg, meta) => {
    if (process.env.DEBUG) console.log(fmt('debug', msg, meta));
  }
};
