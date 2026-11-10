// ---------------------------------------------------------------------------
// Input safety
// Every dynamic string that reaches innerHTML is escaped. Local storage,
// imported backups and third-party APIs are all treated as untrusted.
// ---------------------------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

// Same escaping, named for call sites that place a value inside an attribute.
const escapeAttr = escapeHtml;

function cleanText(value, maxLength = 64) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function numOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

const PAIR_RE = /^[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}$/;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;

