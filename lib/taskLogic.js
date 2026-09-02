'use strict';

/**
 * Pure, dependency-free task/status/notification logic.
 * No imports from express/web-push here on purpose, so this file can be
 * unit-tested with plain `node` even in environments without npm access.
 */

const NEAR_HOURS = 48;

/**
 * @param {{dueDate:string, done?:boolean}} task
 * @param {Date} now
 * @returns {'done'|'overdue'|'near'|'normal'}
 */
function statusOf(task, now) {
  if (task.done) return 'done';
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return 'normal';
  const diffMs = due.getTime() - now.getTime();
  if (diffMs <= 0) return 'overdue';
  if (diffMs <= NEAR_HOURS * 3600 * 1000) return 'near';
  return 'normal';
}

const STATUS_LABEL_TH = {
  done: 'เสร็จแล้ว',
  overdue: 'เลยกำหนด',
  near: 'ใกล้ถึงกำหนด',
  normal: 'ปกติ',
};

const PRIORITY_LABEL_TH = {
  normal: 'ปกติ',
  urgent: 'ด่วน',
  very_urgent: 'ด่วนมาก',
};

/**
 * Create a brand-new task object with sane defaults + generated id.
 */
function newTask(input, idFn) {
  const id = idFn ? idFn() : `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: String(input.title || '').trim(),
    category: input.category || '',
    assignee: input.assignee || '',
    dueDate: input.dueDate, // ISO string
    priority: input.priority || 'normal',
    notes: input.notes || '',
    done: false,
    doneAt: null,
    notifiedNear: false,
    notifiedOverdue: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Apply a partial update to a task. If dueDate changes, reset notification
 * flags so the user gets a fresh near/overdue alert against the new date.
 */
function applyTaskUpdate(task, patch) {
  const updated = { ...task, ...patch, updatedAt: new Date().toISOString() };
  if (patch && patch.dueDate && patch.dueDate !== task.dueDate) {
    updated.notifiedNear = false;
    updated.notifiedOverdue = false;
  }
  if (patch && patch.done === true && !task.done) {
    updated.doneAt = new Date().toISOString();
  }
  if (patch && patch.done === false && task.done) {
    updated.doneAt = null;
  }
  return updated;
}

/**
 * Scan all tasks and decide which ones need a *new* push notification right
 * now (i.e. they just transitioned into 'near' or 'overdue' since the last
 * check), based on the notifiedNear/notifiedOverdue flags stored per task.
 *
 * Returns { toNotify: [{task, type}], updatedTasks: [...] } — updatedTasks
 * is the full task array with flags mutated, ready to be persisted.
 */
function decideNotifications(tasks, now) {
  const toNotify = [];
  const updatedTasks = tasks.map((task) => {
    if (task.done) {
      return task;
    }
    const status = statusOf(task, now);
    let next = task;

    if (status === 'overdue' && !task.notifiedOverdue) {
      toNotify.push({ task, type: 'overdue' });
      next = { ...next, notifiedOverdue: true, notifiedNear: true };
    } else if (status === 'near' && !task.notifiedNear) {
      toNotify.push({ task, type: 'near' });
      next = { ...next, notifiedNear: true };
    } else if (status === 'normal' && (task.notifiedNear || task.notifiedOverdue)) {
      // due date must have moved back out (e.g. edited) — allow future re-alerts
      next = { ...next, notifiedNear: false, notifiedOverdue: false };
    }
    return next;
  });
  return { toNotify, updatedTasks };
}

function notificationPayloadFor(task, type) {
  const title = type === 'overdue' ? 'งานเลยกำหนดแล้ว' : 'งานใกล้ถึงกำหนด';
  const body = task.title || 'งานไม่มีชื่อ';
  return {
    title,
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { taskId: task.id, type, url: '/' },
    tag: `task-${task.id}`,
  };
}

module.exports = {
  NEAR_HOURS,
  statusOf,
  STATUS_LABEL_TH,
  PRIORITY_LABEL_TH,
  newTask,
  applyTaskUpdate,
  decideNotifications,
  notificationPayloadFor,
};
