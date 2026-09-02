'use strict';

/**
 * Demo data used only the very first time the server runs (when
 * data/tasks.json does not exist yet). Mirrors the old localStorage-only
 * version's sample tasks so the dashboard doesn't look empty on first boot.
 *
 * Seeded tasks that are already "near"/"overdue" at seed time have their
 * notified flags pre-set to true, so the very first /api/run-check does not
 * blast out a pile of push notifications for demo data.
 */

const { statusOf } = require('./taskLogic');

function addHours(d, h) {
  return new Date(d.getTime() + h * 3600 * 1000);
}

function uid() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function seedTasks() {
  const t = new Date();

  function mk(title, category, assignee, hoursOffset, priority, notes, done, doneDaysAgo) {
    const due = addHours(t, hoursOffset);
    const task = {
      id: uid(),
      title,
      category,
      assignee,
      dueDate: due.toISOString(),
      priority,
      notes: notes || '',
      done: !!done,
      doneAt: done ? addHours(t, -(doneDaysAgo || 0) * 24).toISOString() : null,
      notifiedNear: false,
      notifiedOverdue: false,
      createdAt: addHours(t, hoursOffset - 24).toISOString(),
      updatedAt: t.toISOString(),
    };
    // Pre-arm flags for demo tasks that already sit in near/overdue territory,
    // so first boot doesn't immediately fire a batch of push notifications.
    const status = statusOf(task, t);
    if (status === 'overdue') {
      task.notifiedOverdue = true;
      task.notifiedNear = true;
    } else if (status === 'near') {
      task.notifiedNear = true;
    }
    return task;
  }

  return [
    mk('ตอบอีเมลลูกค้า VIP', 'ฝ่ายลูกค้าสัมพันธ์', 'สมชาย ใจดี', -48, 'very_urgent',
      'ลูกค้า VIP ร้องเรียนเรื่องการจัดส่งล่าช้า ต้องการคำตอบภายในวันนี้เพื่อรักษาความสัมพันธ์ระยะยาวกับลูกค้า\n\nขั้นตอนถัดไป:\n1. โทรติดต่อลูกค้าเพื่อขอโทษและชี้แจง\n2. เสนอส่วนลดสำหรับคำสั่งซื้อถัดไป\n3. ส่งอีเมลยืนยันภายในวันนี้'),
    mk('ตรวจสอบใบสมัครพนักงานใหม่', 'ฝ่ายบุคคล', 'มะลิ ศรีสุข', -26, 'urgent',
      'มีผู้สมัครตำแหน่งนักการตลาด 12 คน ต้องคัดกรองก่อนนัดสัมภาษณ์รอบแรก'),
    mk('ส่งรายงานยอดขายประจำสัปดาห์', 'แผนกการตลาด', 'สมชาย ใจดี', 3, 'normal',
      'สรุปยอดขายสัปดาห์นี้เทียบกับเป้าหมาย ส่งให้ผู้จัดการฝ่ายก่อนเวลาเลิกงาน'),
    mk('ยืนยันตารางส่งของกับซัพพลายเออร์', 'ฝ่ายจัดซื้อ', 'วิชัย รุ่งเรือง', 22, 'urgent',
      'ยืนยันรอบส่งของล็อตใหม่ให้ตรงกับตารางการผลิต'),
    mk('เตรียมเอกสารประชุมทีมการตลาด', 'แผนกการตลาด', 'สมชาย ใจดี', 46, 'very_urgent',
      'เตรียมสไลด์สรุปผลแคมเปญไตรมาสนี้และแผนงานไตรมาสหน้า'),
    mk('อัปเดตฐานข้อมูลลูกค้า', 'แผนกการตลาด', 'มะลิ ศรีสุข', 96, 'normal',
      'อัปเดตข้อมูลติดต่อลูกค้าที่เปลี่ยนแปลงในเดือนนี้'),
    mk('สรุปผลแคมเปญโฆษณา Q3', 'แผนกการตลาด', 'สมชาย ใจดี', 144, 'normal',
      'รวบรวมผล CTR, conversion และงบที่ใช้จริงเทียบกับแผน'),
    mk('อบรมพนักงานใหม่เรื่องระบบ CRM', 'ฝ่ายบุคคล', 'วิชัย รุ่งเรือง', 240, 'normal',
      'จัดอบรมพนักงานใหม่ 3 คนให้ใช้งานระบบ CRM เป็น'),
    mk('ประชุมทีมประจำสัปดาห์', 'แผนกการตลาด', 'สมชาย ใจดี', -72, 'normal',
      'สรุปความคืบหน้างานประจำสัปดาห์ที่ผ่านมา', true, 3),
  ];
}

module.exports = { seedTasks };
