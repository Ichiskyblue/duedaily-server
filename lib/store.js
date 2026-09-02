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
};
