'use strict';

/**
 * Minimal dependency-free JSON file store. Writes are atomic (write to a
 * temp file then rename) so a crash mid-write can't corrupt the data file.
 * No external packages required — only Node's built-in fs/path modules.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(name) {
  return path.join(DATA_DIR, name);
}

function readJSON(name, fallback) {
  ensureDataDir();
  const p = filePath(name);
  if (!fs.existsSync(p)) return fallback;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[store] failed to read ${name}, using fallback:`, err.message);
    return fallback;
  }
}

function writeJSON(name, data) {
  ensureDataDir();
  const p = filePath(name);
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

// --- Tasks -----------------------------------------------------------------

function loadTasks() {
  return readJSON('tasks.json', []);
}

function saveTasks(tasks) {
  writeJSON('tasks.json', tasks);
}

// --- Push subscriptions ------------------------------------------------------

function loadSubscriptions() {
  return readJSON('subscriptions.json', []);
}

function saveSubscriptions(subs) {
  writeJSON('subscriptions.json', subs);
}

// --- VAPID keys --------------------------------------------------------------

function loadVapid() {
  return readJSON('vapid.json', null);
}

function saveVapid(keys) {
  writeJSON('vapid.json', keys);
}

// --- Incharge daily checklist ------------------------------------------------
// checklist-items.json: array of item "templates" (the customizable to-do
// list itself, e.g. "เช็คใบเสร็จ"). checklist-status.json: which items were
// checked off on which day, e.g. { "2026-09-04": { "abc123": true } }.
// Keeping status keyed by date (instead of destructively resetting) means a
// new day just starts with no entry — no reset job needed, and today's
// applicability (daily vs. specific weekdays) is decided by the client using
// its own local date, so the checklist's "day" always matches the user's
// device, not the server's.

function loadChecklistItems() {
  return readJSON('checklist-items.json', []);
}

function saveChecklistItems(items) {
  writeJSON('checklist-items.json', items);
}

function loadChecklistStatus() {
  return readJSON('checklist-status.json', {});
}

function saveChecklistStatus(status) {
  writeJSON('checklist-status.json', status);
}

module.exports = {
  DATA_DIR,
  ensureDataDir,
  readJSON,
  writeJSON,
  loadTasks,
  saveTasks,
  loadSubscriptions,
  saveSubscriptions,
  loadVapid,
  saveVapid,
  loadChecklistItems,
  saveChecklistItems,
  loadChecklistStatus,
  saveChecklistStatus,
};
