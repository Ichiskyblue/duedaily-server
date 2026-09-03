'use strict';

const path = require('path');
const express = require('express');
const store = require('./lib/store');
const { newTask, applyTaskUpdate, decideNotifications, notificationPayloadFor } = require('./lib/taskLogic');
const { initPush, sendToAll } = require('./lib/push');
const { seedTasks, seedChecklistItems } = require('./lib/seed');

const PORT = process.env.PORT || 3000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';

const vapidKeys = initPush({ contactEmail: CONTACT_EMAIL });

// First-run only: populate demo tasks so the dashboard isn't empty.
// Once data/tasks.json exists (even as []), this never runs again.
if (!require('fs').existsSync(require('path').join(store.DATA_DIR, 'tasks.json'))) {
  store.saveTasks(seedTasks());
  console.log('[server] First run detected — seeded demo tasks into data/tasks.json');
}
if (!require('fs').existsSync(require('path').join(store.DATA_DIR, 'checklist-items.json'))) {
  store.saveChecklistItems(seedChecklistItems());
  console.log('[server] First run detected — seeded default Incharge checklist items');
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Tasks CRUD
// ---------------------------------------------------------------------------

app.get('/api/tasks', (req, res) => {
  res.json(store.loadTasks());
});

app.post('/api/tasks', (req, res) => {
  const body = req.body || {};
  if (!body.title || !body.dueDate) {
    return res.status(400).json({ error: 'title และ dueDate จำเป็นต้องมี' });
  }
  const tasks = store.loadTasks();
  const task = newTask(body);
  tasks.push(task);
  store.saveTasks(tasks);
  res.status(201).json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const tasks = store.loadTasks();
  const idx = tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'ไม่พบงานนี้' });
  const updated = applyTaskUpdate(tasks[idx], req.body || {});
  tasks[idx] = updated;
  store.saveTasks(tasks);
  res.json(updated);
});

app.delete('/api/tasks/:id', (req, res) => {
  const tasks = store.loadTasks();
  const next = tasks.filter((t) => t.id !== req.params.id);
  if (next.length === tasks.length) return res.status(404).json({ error: 'ไม่พบงานนี้' });
  store.saveTasks(next);
  res.status(204).end();
});

app.post('/api/tasks/import', (req, res) => {
  const incoming = req.body && req.body.tasks;
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' });
  const normalized = incoming.map((t) => ({
    id: t.id || newTask(t).id,
    title: t.title || '',
    category: t.category || '',
    assignee: t.assignee || '',
    dueDate: t.dueDate,
    priority: t.priority || 'normal',
    notes: t.notes || '',
    done: !!t.done,
    doneAt: t.doneAt || t.completedAt || null,
    notifiedNear: false,
    notifiedOverdue: false,
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  store.saveTasks(normalized);
  res.json({ ok: true, count: normalized.length });
});

app.delete('/api/tasks', (req, res) => {
  store.saveTasks([]);
  res.json({ ok: true });
});

app.post('/api/tasks/:id/done', (req, res) => {
  const tasks = store.loadTasks();
  const idx = tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'ไม่พบงานนี้' });
  const done = req.body && typeof req.body.done === 'boolean' ? req.body.done : !tasks[idx].done;
  tasks[idx] = applyTaskUpdate(tasks[idx], { done });
  store.saveTasks(tasks);
  res.json(tasks[idx]);
});

// ---------------------------------------------------------------------------
// Incharge daily checklist
// ---------------------------------------------------------------------------
// Items are the customizable checklist template (add/edit/delete/reorder).
// Status is which items were checked off on a given date (client-supplied
// date string, e.g. "2026-09-04") — this keeps "today"/"which weekday" tied
// to the user's own device clock/timezone rather than the server's.

function uid() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const VALID_PERIODS = ['morning', 'midday', 'evening'];

app.get('/api/checklist/items', (req, res) => {
  res.json(store.loadChecklistItems());
});

app.post('/api/checklist/items', (req, res) => {
  const body = req.body || {};
  const text = (body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'ต้องระบุชื่อรายการ' });
  if (!VALID_PERIODS.includes(body.period)) return res.status(400).json({ error: 'ช่วงเวลาไม่ถูกต้อง' });
  const frequency = body.frequency === 'custom' ? 'custom' : 'daily';
  const days = frequency === 'custom' && Array.isArray(body.days)
    ? body.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];

  const items = store.loadChecklistItems();
  const newItem = {
    id: uid(),
    text,
    period: body.period,
    frequency,
    days,
    createdAt: new Date().toISOString(),
  };
  items.push(newItem);
  store.saveChecklistItems(items);
  res.status(201).json(newItem);
});

app.put('/api/checklist/items/:id', (req, res) => {
  const items = store.loadChecklistItems();
  const idx = items.findIndex((it) => it.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
  const body = req.body || {};
  const current = items[idx];
  const text = body.text !== undefined ? String(body.text).trim() : current.text;
  if (!text) return res.status(400).json({ error: 'ต้องระบุชื่อรายการ' });
  const period = VALID_PERIODS.includes(body.period) ? body.period : current.period;
  const frequency = body.frequency === 'custom' ? 'custom' : (body.frequency === 'daily' ? 'daily' : current.frequency);
  const days = frequency === 'custom'
    ? (Array.isArray(body.days) ? body.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : current.days)
    : [];
  items[idx] = { ...current, text, period, frequency, days };
  store.saveChecklistItems(items);
  res.json(items[idx]);
});

app.delete('/api/checklist/items/:id', (req, res) => {
  const items = store.loadChecklistItems();
  const next = items.filter((it) => it.id !== req.params.id);
  if (next.length === items.length) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
  store.saveChecklistItems(next);
  res.status(204).end();
});

app.post('/api/checklist/items/reorder', (req, res) => {
  const { period, orderedIds } = req.body || {};
  if (!VALID_PERIODS.includes(period) || !Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  const items = store.loadChecklistItems();
  const inPeriod = items.filter((it) => it.period === period);
  const others = items.filter((it) => it.period !== period);
  const byId = new Map(inPeriod.map((it) => [it.id, it]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  // Any items in this period not mentioned (shouldn't normally happen) keep their relative order at the end.
  const missing = inPeriod.filter((it) => !orderedIds.includes(it.id));
  store.saveChecklistItems([...others, ...reordered, ...missing]);
  res.json({ ok: true });
});

app.get('/api/checklist/status', (req, res) => {
  const date = req.query.date;
  const all = store.loadChecklistStatus();
  res.json((date && all[date]) || {});
});

app.post('/api/checklist/status', (req, res) => {
  const { date, itemId, done } = req.body || {};
  if (!date || !itemId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  const all = store.loadChecklistStatus();
  if (!all[date]) all[date] = {};
  all[date][itemId] = !!done;
  store.saveChecklistStatus(all);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------------

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'subscription ไม่ถูกต้อง' });
  const subs = store.loadSubscriptions();
  const exists = subs.some((s) => s.endpoint === sub.endpoint);
  if (!exists) {
    subs.push(sub);
    store.saveSubscriptions(subs);
  }
  res.status(201).json({ ok: true });
});

app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  const subs = store.loadSubscriptions();
  store.saveSubscriptions(subs.filter((s) => s.endpoint !== endpoint));
  res.json({ ok: true });
});

app.post('/api/test-notification', async (req, res) => {
  try {
    const result = await sendToAll({
      title: 'ทดสอบการแจ้งเตือน',
      body: 'ถ้าเห็นข้อความนี้ แปลว่าการแจ้งเตือนทำงานถูกต้อง',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/' },
      tag: 'test-notification',
    });
    res.json(result);
  } catch (err) {
    console.error('[api] test-notification failed:', err);
    res.status(500).json({ error: 'ส่งการแจ้งเตือนไม่สำเร็จ' });
  }
});

// ---------------------------------------------------------------------------
// Due-date checker — can be triggered internally (setInterval below) or by
// an external uptime/cron pinger, which matters on free hosts that put the
// server to sleep and only wake it on an incoming HTTP request.
// ---------------------------------------------------------------------------

async function runCheck() {
  const tasks = store.loadTasks();
  const now = new Date();
  const { toNotify, updatedTasks } = decideNotifications(tasks, now);
  store.saveTasks(updatedTasks);

  let sent = 0;
  for (const { task, type } of toNotify) {
    const result = await sendToAll(notificationPayloadFor(task, type));
    sent += result.sent;
  }
  return { checked: tasks.length, notifications: toNotify.length, pushesSent: sent };
}

app.get('/api/run-check', async (req, res) => {
  try {
    res.json(await runCheck());
  } catch (err) {
    console.error('[api] run-check failed:', err);
    res.status(500).json({ error: 'ตรวจสอบไม่สำเร็จ' });
  }
});
app.post('/api/run-check', async (req, res) => {
  try {
    res.json(await runCheck());
  } catch (err) {
    console.error('[api] run-check failed:', err);
    res.status(500).json({ error: 'ตรวจสอบไม่สำเร็จ' });
  }
});

app.listen(PORT, () => {
  console.log(`DueDaily server running on http://localhost:${PORT}`);
  setInterval(() => {
    runCheck().catch((err) => console.error('[scheduler] runCheck failed:', err));
  }, CHECK_INTERVAL_MS);
  // also run once shortly after boot
  setTimeout(() => {
    runCheck().catch((err) => console.error('[scheduler] initial runCheck failed:', err));
  }, 5000);
});
