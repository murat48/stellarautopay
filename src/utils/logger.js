/**
 * Production-ready logger with:
 *  - Log levels: debug < info < warn < error
 *  - localStorage ring-buffer (last MAX_LOGS entries persist across reloads)
 *  - JSON export / download for user support
 *  - In production, debug logs are suppressed
 */

const MAX_LOGS = 200;
const LOG_KEY   = 'autopay_logs';
const LEVELS    = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = import.meta.env.PROD ? LEVELS.info : LEVELS.debug;

function serialize(val) {
  if (typeof val === 'string') return val;
  try { return JSON.stringify(val); } catch { return String(val); }
}

function write(level, tag, ...args) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const ts    = new Date().toISOString();
  const msg   = args.map(serialize).join(' ');
  const entry = { ts, level, tag, msg };

  // Console output
  const fn = level === 'error' ? console.error
           : level === 'warn'  ? console.warn
           : console.log;
  fn(`[${level.toUpperCase()}] [${tag}]`, ...args);

  // Persist to localStorage ring-buffer
  try {
    const raw  = localStorage.getItem(LOG_KEY);
    const logs = raw ? JSON.parse(raw) : [];
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
    localStorage.setItem(LOG_KEY, JSON.stringify(logs));
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

export const logger = {
  debug: (tag, ...args) => write('debug', tag, ...args),
  info:  (tag, ...args) => write('info',  tag, ...args),
  warn:  (tag, ...args) => write('warn',  tag, ...args),
  error: (tag, ...args) => write('error', tag, ...args),

  /** Returns all stored log entries as an array. */
  getLogs() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); }
    catch { return []; }
  },

  /** Clears the log buffer from localStorage. */
  clearLogs() {
    localStorage.removeItem(LOG_KEY);
  },

  /** Downloads the log buffer as a JSON file for support/debugging. */
  downloadLogs() {
    const logs = this.getLogs();
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `autopay-logs-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
