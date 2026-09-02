/* =========================================================================
   DueDaily — ระบบแจ้งเตือนงานประจำวัน (server-backed + push notifications)
   Single-user. Tasks live on the server (data/tasks.json) so real push
   notifications can be sent even when this page/phone is closed.
   Profile (display name / app name) stays in localStorage — cosmetic,
   per-device only, doesn't need to round-trip through the server.
   ========================================================================= */

(function () {
  "use strict";

  var PROFILE_KEY = "duedaily.profile.v1";
  var DEFAULT_PROFILE = { displayName: "สมชาย ใจดี", appName: "DueDaily" };

  var THAI_MONTHS_FULL = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  var THAI_MONTHS_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  var THAI_DOW = ["จ","อ","พ","พฤ","ศ","ส","อา"]; // Monday-first

  /* ---------------------------- Icons (SVG) ---------------------------- */
  var ICON = {
    overdue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 2.11 18a2 2 0 0 0 1.71 3h16.36a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
    near: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
    normal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>'
  };

  /* ---------------------------- Date helpers ---------------------------- */
  function now() { return new Date(); }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function dateOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function isSameDate(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function toBE(year) { return year + 543; }
  function fmtDateShort(d) { return d.getDate() + " " + THAI_MONTHS_SHORT[d.getMonth()]; }
  function fmtTime(d) { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function fmtDateTimeFull(d) {
    return d.getDate() + " " + THAI_MONTHS_SHORT[d.getMonth()] + " " + toBE(d.getFullYear()) + " · " + fmtTime(d) + " น.";
  }
  function fmtDateKey(d) { return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  var NEAR_HOURS = 48;

  /* ---------------------------- State ---------------------------- */
  var state = {
    tasks: [],
    profile: null,
    selectedTaskId: null,
    view: "dashboard",
    calYear: now().getFullYear(),
    calMonth: now().getMonth(),
    selectedDate: dateOnly(now()),
    searchQuery: "",
    pillFilter: "all",
    sortByPriority: false,
    showDoneInTable: false
  };

  /* ---------------------------- API helpers ---------------------------- */
  function apiGet(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error("GET " + path + " -> " + r.status);
      return r.json();
    });
  }
  function apiSend(path, method, body) {
    return fetch(path, {
      method: method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error(method + " " + path + " -> " + r.status);
      if (r.status === 204) return null;
      return r.json().catch(function () { return null; });
    });
  }

  async function loadTasksFromServer() {
    try {
      state.tasks = await apiGet("/api/tasks");
      setServerWarning(false);
    } catch (e) {
      console.error(e);
      setServerWarning(true);
      state.tasks = state.tasks || [];
    }
  }
  function setServerWarning(show) {
    var banner = el("serverWarningBanner");
    if (banner) banner.hidden = !show;
  }
  async function refreshAndRender() {
    await loadTasksFromServer();
    renderAll();
  }

  /* ---------------------------- Profile (localStorage, per-device) ---------------------------- */
  function loadProfile() {
    try {
      var raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        displayName: parsed.displayName || DEFAULT_PROFILE.displayName,
        appName: parsed.appName || DEFAULT_PROFILE.appName
      };
    } catch (e) {
      return null;
    }
  }
  function saveProfile() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    } catch (e) {
      toast("บันทึกโปรไฟล์ไม่สำเร็จ");
    }
  }
  function initialsOf(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2);
    return parts[0].slice(0, 1) + parts[1].slice(0, 1);
  }
  function renderProfile() {
    var p = state.profile;
    el("userAvatar").textContent = initialsOf(p.displayName);
    el("brandWord").textContent = p.appName;
    document.title = p.appName + " — ระบบแจ้งเตือนงานประจำวัน";
  }

  /* ---------------------------- Status logic (mirrors lib/taskLogic.js) ---------------------------- */
  function statusOf(task) {
    if (task.done) return "done";
    var due = new Date(task.dueDate);
    var t = now();
    if (due.getTime() < t.getTime()) return "overdue";
    if (due.getTime() - t.getTime() <= NEAR_HOURS * 3600000) return "near";
    return "normal";
  }
  function statusColor(status) {
    if (status === "overdue") return "coral";
    if (status === "near") return "amber";
    return "sage";
  }
  function statusLabel(status) {
    if (status === "overdue") return "เลยกำหนด";
    if (status === "near") return "ใกล้ถึงกำหนด";
    if (status === "done") return "เสร็จแล้ว";
    return "ปกติ";
  }
  function priorityLabel(p) {
    if (p === "very_urgent") return "ด่วนมาก";
    if (p === "urgent") return "ด่วน";
    return "ปกติ";
  }
  function relText(task) {
    var status = statusOf(task);
    var due = new Date(task.dueDate);
    var t = now();
    var diffMs = due.getTime() - t.getTime();
    var diffH = Math.abs(diffMs) / 3600000;
    if (status === "done") return "เสร็จแล้ว";
    if (status === "overdue") {
      var days = Math.floor(diffH / 24);
      if (days >= 1) return "เลยกำหนด " + days + " วัน";
      return "เลยกำหนด " + Math.max(1, Math.round(diffH)) + " ชม.";
    }
    if (status === "near") {
      if (diffH < 24) return "เหลือ " + Math.max(1, Math.round(diffH)) + " ชม.";
      return "เหลือ " + Math.round(diffH / 24) + " วัน";
    }
    var d = Math.round(diffH / 24);
    return "เหลืออีก " + d + " วัน";
  }

  function activeTasks() { return state.tasks.filter(function (t) { return !t.done; }); }

  function statusRank(status) { return status === "overdue" ? 0 : status === "near" ? 1 : 2; }
  function sortTasks(list, byPriority) {
    var prioRank = { very_urgent: 0, urgent: 1, normal: 2 };
    return list.slice().sort(function (a, b) {
      if (byPriority) {
        var pa = prioRank[a.priority], pb = prioRank[b.priority];
        if (pa !== pb) return pa - pb;
      }
      var sa = statusRank(statusOf(a)), sb = statusRank(statusOf(b));
      if (!byPriority && sa !== sb) return sa - sb;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  }

  function matchesFilters(task) {
    var status = statusOf(task);
    var q = state.searchQuery.trim().toLowerCase();
    if (q) {
      var hay = (task.title + " " + task.category + " " + task.assignee).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (state.pillFilter === "near" && status !== "near") return false;
    if (state.pillFilter === "overdue" && status !== "overdue") return false;
    if (state.pillFilter === "urgent" && task.priority !== "urgent" && task.priority !== "very_urgent") return false;
    return true;
  }

  /* ---------------------------- Rendering ---------------------------- */
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderAll() {
    renderProfile();
    renderGreeting();
    renderStats();
    renderTaskList();
    renderDetail();
    renderCalendar();
    renderTimeline();
    renderBell();
    if (state.view === "all-tasks") renderAllTasksTable();
  }

  function renderGreeting() {
    var h = now().getHours();
    var greet = h < 12 ? "สวัสดีตอนเช้า" : h < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";
    var firstName = String(state.profile.displayName || "").trim().split(/\s+/)[0] || "";
    el("greetTitle").textContent = greet + (firstName ? ", คุณ" + firstName : "");
    var act = activeTasks();
    var overdue = act.filter(function (t) { return statusOf(t) === "overdue"; }).length;
    var sub = state.profile.appName + " หวังให้วันนี้เป็นวันที่ดีและมีประสิทธิภาพ วันนี้มีงาน " + act.length + " รายการที่ต้องติดตาม";
    if (overdue > 0) sub += " และมี " + overdue + " รายการที่เลยกำหนดแล้ว ควรจัดการก่อนเป็นอันดับแรก";
    else sub += " ไม่มีงานเลยกำหนด ทำได้ดีมาก 🎉";
    el("greetSub").textContent = sub;
  }

  function renderStats() {
    var act = activeTasks();
    var near = 0, overdue = 0, normal = 0;
    var prioCount = { normal: 0, urgent: 0, very_urgent: 0 };
    act.forEach(function (t) {
      var s = statusOf(t);
      if (s === "near") near++; else if (s === "overdue") overdue++; else normal++;
      prioCount[t.priority] = (prioCount[t.priority] || 0) + 1;
    });
    el("statNear").textContent = near;
    el("statOverdue").textContent = overdue;
    el("statNormal").textContent = normal;
    el("prioNormal").textContent = prioCount.normal;
    el("prioUrgent").textContent = prioCount.urgent;
    el("prioVUrgent").textContent = prioCount.very_urgent;

    // 7-day forward bar chart: number of active tasks due each day (today..+6)
    var today = dateOnly(now());
    var counts = [];
    for (var i = 0; i < 7; i++) {
      var day = addDays(today, i);
      var c = act.filter(function (t) { return isSameDate(dateOnly(new Date(t.dueDate)), day); }).length;
      counts.push(c);
    }
    var max = Math.max.apply(null, counts.concat([1]));
    var barsHtml = counts.map(function (c) {
      var pct = Math.max(6, Math.round((c / max) * 100));
      return '<i style="height:' + pct + '%" title="' + c + ' งาน"></i>';
    }).join("");
    el("bars7day").innerHTML = barsHtml;
    el("barsCaption").innerHTML = "<span>" + fmtDateShort(today) + "</span><span>" + fmtDateShort(addDays(today, 6)) + "</span>";

    // due today
    var dueTodayList = act.filter(function (t) { return isSameDate(dateOnly(new Date(t.dueDate)), today); });
    el("dueTodayTotal").textContent = dueTodayList.length;
    el("dueTodayOverdue").textContent = dueTodayList.filter(function (t) { return statusOf(t) === "overdue"; }).length;
    el("dueTodayNear").textContent = dueTodayList.filter(function (t) { return statusOf(t) === "near"; }).length;

    // completed last 7 days
    var doneCounts = [];
    for (var j = 6; j >= 0; j--) {
      var d2 = addDays(today, -j);
      var c2 = state.tasks.filter(function (t) {
        return t.done && t.doneAt && isSameDate(dateOnly(new Date(t.doneAt)), d2);
      }).length;
      doneCounts.push(c2);
    }
    var doneToday = doneCounts[doneCounts.length - 1];
    var doneAvg = (doneCounts.reduce(function (a, b) { return a + b; }, 0) / 7);
    var doneMax = Math.max.apply(null, doneCounts);
    el("doneToday").textContent = doneToday;
    el("doneAvg").textContent = (Math.round(doneAvg * 10) / 10);
    el("doneMax").textContent = doneMax;

    // line chart
    var w = 260, h2 = 64, pad = 6;
    var dmax = Math.max.apply(null, doneCounts.concat([1]));
    var pts = doneCounts.map(function (v, idx) {
      var x = (idx / (doneCounts.length - 1)) * (w - pad * 2) + pad;
      var y = h2 - pad - (v / dmax) * (h2 - pad * 2);
      return [x, y];
    });
    var polyline = pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
    var svg = '<polyline points="' + polyline + '" fill="none" stroke="#3a1f2c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
    // Only draw the "peak" marker when there's an actual peak to point at
    // (i.e. at least one completed task in the last 7 days). With zero
    // completed tasks, doneCounts is all zeros and there's nothing to mark.
    var hasRealPeak = doneCounts.some(function (v) { return v > 0; });
    if (hasRealPeak) {
      var peakIdx = doneCounts.lastIndexOf(dmax);
      var peak = pts[peakIdx];
      svg += '<line x1="' + peak[0].toFixed(1) + '" y1="4" x2="' + peak[0].toFixed(1) + '" y2="' + (h2 - 4) + '" stroke="#3a1f2c" stroke-width="1" stroke-dasharray="3 3" opacity=".45"/>' +
        '<circle cx="' + peak[0].toFixed(1) + '" cy="' + peak[1].toFixed(1) + '" r="4" fill="#3a1f2c"/>';
    }
    el("lineChart").innerHTML = svg;
  }

  function taskRowHtml(task, showDoneBtn) {
    var status = statusOf(task);
    var color = statusColor(status);
    var icon = status === "overdue" ? ICON.overdue : status === "near" ? ICON.near : ICON.normal;
    var selected = task.id === state.selectedTaskId ? " selected" : "";
    return (
      '<div class="task-row' + selected + '" data-id="' + task.id + '">' +
      '<div class="row-icon ' + color + '">' + icon + "</div>" +
      '<div class="row-body">' +
      '<div class="t">' + esc(task.title) + "</div>" +
      '<div class="s">' + esc(task.category || "ไม่ระบุหมวดหมู่") + "</div>" +
      "</div>" +
      '<div class="row-right">' +
      '<div class="time">' + fmtDateShort(new Date(task.dueDate)) + " · " + fmtTime(new Date(task.dueDate)) + "</div>" +
      '<div class="rel ' + color + '">' + esc(relText(task)) + "</div>" +
      "</div>" +
      (showDoneBtn ? '<button class="row-done-btn" data-done-id="' + task.id + '" title="ทำเครื่องหมายว่าเสร็จแล้ว">' + ICON.normal + "</button>" : "") +
      "</div>"
    );
  }

  function renderTaskList() {
    var list = activeTasks().filter(matchesFilters);
    list = sortTasks(list, state.sortByPriority);
    var container = el("taskList");
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">ไม่พบงานที่ตรงกับเงื่อนไข ลองล้างตัวกรองหรือเพิ่มงานใหม่</div>';
      return;
    }
    container.innerHTML = list.map(function (t) { return taskRowHtml(t, true); }).join("");
    container.querySelectorAll(".task-row").forEach(function (rowEl) {
      rowEl.addEventListener("click", function () {
        state.selectedTaskId = rowEl.getAttribute("data-id");
        renderTaskList();
        renderDetail();
      });
    });
    container.querySelectorAll("[data-done-id]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        markDone(btn.getAttribute("data-done-id"), true);
      });
    });
    el("sortToggle").textContent = state.sortByPriority ? "เรียงตามความสำคัญ" : "เรียงตามกำหนดส่ง";
  }

  function renderDetail() {
    var card = el("detailCard");
    var task = state.tasks.find(function (t) { return t.id === state.selectedTaskId; });
    if (!task) {
      if (state.tasks.length === 0) {
        card.innerHTML = '<div class="detail-empty">ยังไม่มีงานในระบบ<br>คลิก “เพิ่มงานใหม่” เพื่อเริ่มต้นใช้งาน</div>';
      } else {
        card.innerHTML = '<div class="detail-empty">เลือกงานจากรายการทางซ้ายเพื่อดูรายละเอียด</div>';
      }
      return;
    }
    var status = statusOf(task);
    var color = statusColor(status);
    var due = new Date(task.dueDate);
    var updated = new Date(task.updatedAt || task.createdAt);
    var doneTagHtml = task.done ? '<div class="tag">เสร็จแล้ว ✓</div>' : "";
    card.innerHTML =
      '<div class="detail-head">' +
      "<h3>" + esc(task.title) + "</h3>" +
      '<div class="detail-id">#TASK-' + esc(task.id.slice(-4).toUpperCase()) + "</div>" +
      "</div>" +
      '<div class="detail-sub">' + esc(task.category || "ไม่ระบุหมวดหมู่") + " · " + esc(task.assignee || "ไม่ระบุผู้รับผิดชอบ") + " · " + esc(relText(task)) + "</div>" +
      '<div class="tag-row">' +
      '<div class="tag">' + priorityLabel(task.priority) + "</div>" +
      '<div class="tag">' + statusLabel(status) + "</div>" +
      doneTagHtml +
      "</div>" +
      '<div class="detail-updated">กำหนดส่ง ' + fmtDateTimeFull(due) + " · อัปเดตล่าสุด " + fmtDateTimeFull(updated) + "</div>" +
      (task.notes ? '<div class="detail-block"><h4>รายละเอียด / บันทึก</h4><p>' + esc(task.notes) + "</p></div>" : "") +
      '<div class="detail-actions">' +
      (task.done
        ? '<button class="btn-done" data-undo-id="' + task.id + '">เปิดงานนี้อีกครั้ง</button>'
        : '<button class="btn-done" data-done-id2="' + task.id + '">ทำเครื่องหมายว่าเสร็จแล้ว</button>') +
      '<button class="btn-edit" data-edit-id="' + task.id + '">แก้ไข</button>' +
      '<button class="btn-delete" data-delete-id="' + task.id + '">ลบ</button>' +
      "</div>";

    var doneBtn = card.querySelector("[data-done-id2]");
    if (doneBtn) doneBtn.addEventListener("click", function () { markDone(task.id, true); });
    var undoBtn = card.querySelector("[data-undo-id]");
    if (undoBtn) undoBtn.addEventListener("click", function () { markDone(task.id, false); });
    card.querySelector("[data-edit-id]").addEventListener("click", function () { openModal("edit", task.id); });
    card.querySelector("[data-delete-id]").addEventListener("click", function () { deleteTask(task.id); });
  }

  function renderCalendar() {
    var y = state.calYear, m = state.calMonth;
    el("calMonthLabel").textContent = THAI_MONTHS_FULL[m] + " " + toBE(y);

    var firstOfMonth = new Date(y, m, 1);
    var startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday=0
    var gridStart = addDays(firstOfMonth, -startOffset);

    var todayD = dateOnly(now());
    var act = activeTasks();
    var dotsByDate = {};
    act.forEach(function (t) {
      var d = dateOnly(new Date(t.dueDate));
      var key = fmtDateKey(d);
      var s = statusOf(t);
      var rank = statusRank(s);
      if (!dotsByDate[key] || rank < dotsByDate[key]) dotsByDate[key] = rank;
    });

    var html = THAI_DOW.map(function (d) { return '<div class="dow">' + d + "</div>"; }).join("");
    for (var i = 0; i < 42; i++) {
      var cellDate = addDays(gridStart, i);
      var inMonth = cellDate.getMonth() === m;
      var isToday = isSameDate(cellDate, todayD);
      var isSelected = isSameDate(cellDate, state.selectedDate);
      var key = fmtDateKey(cellDate);
      var dotRank = dotsByDate[key];
      var dotColor = dotRank === 0 ? "coral" : dotRank === 1 ? "amber" : dotRank === 2 ? "sage" : null;
      var cls = "day" + (inMonth ? "" : " muted") + (isToday ? " today" : "") + (isSelected ? " selected" : "");
      html += '<div class="' + cls + '" data-date="' + cellDate.toISOString() + '">' +
        cellDate.getDate() +
        (dotColor ? '<span class="dotmark ' + dotColor + '"></span>' : "") +
        "</div>";
    }
    el("calGrid").innerHTML = html;
    el("calGrid").querySelectorAll(".day").forEach(function (dayEl) {
      dayEl.addEventListener("click", function () {
        var d = new Date(dayEl.getAttribute("data-date"));
        state.selectedDate = dateOnly(d);
        state.calYear = d.getFullYear();
        state.calMonth = d.getMonth();
        renderCalendar();
        renderTimeline();
      });
    });
  }

  function renderTimeline() {
    var d = state.selectedDate;
    var isToday = isSameDate(d, dateOnly(now()));
    el("tlTitle").textContent = (isToday ? "วันนี้" : fmtDateShort(d)) + " — ไทม์ไลน์";

    var list = activeTasks().filter(function (t) { return isSameDate(dateOnly(new Date(t.dueDate)), d); });
    list.sort(function (a, b) { return new Date(a.dueDate) - new Date(b.dueDate); });

    var wrap = el("tlList");
    if (list.length === 0) {
      wrap.classList.add("empty");
      wrap.innerHTML = '<div class="tl-empty">ไม่มีงานที่กำหนดส่งในวันนี้</div>';
      return;
    }
    wrap.classList.remove("empty");
    wrap.innerHTML = list.map(function (t) {
      var status = statusOf(t);
      var color = statusColor(status);
      var icon = status === "overdue" ? ICON.overdue : status === "near" ? ICON.near : ICON.normal;
      return (
        '<div class="tl-row">' +
        '<div class="tl-time">' + fmtTime(new Date(t.dueDate)) + "</div>" +
        '<div class="tl-card-item ' + color + '" data-id="' + t.id + '">' +
        '<div class="tl-icon ' + color + '">' + icon + "</div>" +
        '<div class="tl-body">' +
        '<div class="t">' + esc(t.title) + "</div>" +
        '<div class="s">' + esc(t.category || "ไม่ระบุหมวดหมู่") + " · " + esc(relText(t)) + "</div>" +
        "</div></div></div>"
      );
    }).join("");
    wrap.querySelectorAll("[data-id]").forEach(function (itemEl) {
      itemEl.addEventListener("click", function () {
        setView("dashboard");
        state.selectedTaskId = itemEl.getAttribute("data-id");
        renderTaskList();
        renderDetail();
      });
    });
  }

  function renderBell() {
    var alerts = activeTasks().filter(function (t) { var s = statusOf(t); return s === "overdue" || s === "near"; });
    alerts = sortTasks(alerts, false);
    el("bellDot").hidden = alerts.length === 0;
    var panel = el("bellPanel");
    if (alerts.length === 0) {
      panel.innerHTML = '<div class="bp-head">การแจ้งเตือน</div><div class="bp-empty">ไม่มีการแจ้งเตือนในขณะนี้ 🎉</div>';
      return;
    }
    var top = alerts.slice(0, 8);
    var html = '<div class="bp-head">การแจ้งเตือน (' + alerts.length + ')</div>';
    html += top.map(function (t) {
      var color = statusColor(statusOf(t));
      return '<div class="bp-item" data-id="' + t.id + '">' +
        '<div class="bp-dot ' + color + '" style="background:var(--' + color + ')"></div>' +
        '<div><div class="t">' + esc(t.title) + '</div><div class="d">' + esc(relText(t)) + "</div></div>" +
        "</div>";
    }).join("");
    if (alerts.length > top.length) {
      html += '<div class="bp-empty">และอีก ' + (alerts.length - top.length) + " รายการ</div>";
    }
    panel.innerHTML = html;
    panel.querySelectorAll("[data-id]").forEach(function (itemEl) {
      itemEl.addEventListener("click", function () {
        panel.classList.remove("open");
        setView("dashboard");
        state.selectedTaskId = itemEl.getAttribute("data-id");
        renderTaskList();
        renderDetail();
      });
    });
  }

  function renderAllTasksTable() {
    var list = state.tasks.filter(function (t) {
      if (!state.showDoneInTable && t.done) return false;
      return matchesFilters(t);
    });
    list = sortTasks(list, state.sortByPriority);
    var body = el("allTasksBody");
    var empty = el("allTasksEmpty");
    if (list.length === 0) {
      body.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    body.innerHTML = list.map(function (t) {
      var status = statusOf(t);
      var color = statusColor(status);
      var rowCls = t.done ? "row-done" : status === "overdue" ? "row-overdue" : status === "near" ? "row-near" : "";
      var icon = status === "done" ? ICON.normal : status === "overdue" ? ICON.overdue : status === "near" ? ICON.near : ICON.normal;
      return (
        '<tr class="' + rowCls + '" data-id="' + t.id + '">' +
        "<td><div class=\"tt-name\">" + esc(t.title) + '</div><div class="tt-cat">' + esc(t.category || "-") + "</div></td>" +
        "<td>" + fmtDateShort(new Date(t.dueDate)) + " · " + fmtTime(new Date(t.dueDate)) + "<br><span style='font-size:11px;color:var(--muted)'>" + esc(relText(t)) + "</span></td>" +
        '<td><span class="prio-badge ' + t.priority + '">' + priorityLabel(t.priority) + "</span></td>" +
        '<td><span class="status-chip ' + (t.done ? "muted" : color) + '">' + icon + " " + statusLabel(t.done ? "done" : status) + "</span></td>" +
        '<td><div class="tt-actions">' +
        '<button data-edit="' + t.id + '" title="แก้ไข">' + ICON.edit + "</button>" +
        '<button data-toggle="' + t.id + '" title="' + (t.done ? "เปิดใหม่อีกครั้ง" : "ทำเครื่องหมายว่าเสร็จแล้ว") + '">' + (t.done ? ICON.undo : ICON.normal) + "</button>" +
        '<button data-del="' + t.id + '" title="ลบ">' + ICON.trash + "</button>" +
        "</div></td>" +
        "</tr>"
      );
    }).join("");
    body.querySelectorAll("[data-edit]").forEach(function (b) { b.addEventListener("click", function () { openModal("edit", b.getAttribute("data-edit")); }); });
    body.querySelectorAll("[data-toggle]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-toggle");
        var t = state.tasks.find(function (x) { return x.id === id; });
        markDone(id, !t.done);
      });
    });
    body.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { deleteTask(b.getAttribute("data-del")); }); });
  }

  /* ---------------------------- Mutations (all go through the server API) ---------------------------- */
  async function markDone(id, done) {
    try {
      await apiSend("/api/tasks/" + id + "/done", "POST", { done: done });
      await refreshAndRender();
      toast(done ? "ทำเครื่องหมายว่าเสร็จแล้ว 🎉" : "เปิดงานนี้อีกครั้งแล้ว");
    } catch (e) {
      console.error(e);
      toast("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
  }

  async function deleteTask(id) {
    var t = state.tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    if (!confirm('ลบงาน "' + t.title + '" ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้')) return;
    try {
      await apiSend("/api/tasks/" + id, "DELETE");
      if (state.selectedTaskId === id) state.selectedTaskId = null;
      await refreshAndRender();
      toast("ลบงานแล้ว");
    } catch (e) {
      console.error(e);
      toast("ลบไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
  }

  /* ---------------------------- View switching ---------------------------- */
  function setView(view) {
    state.view = view;
    document.querySelectorAll(".nav-item[data-view]").forEach(function (n) {
      n.classList.toggle("active", n.getAttribute("data-view") === view);
    });
    el("view-dashboard").hidden = view !== "dashboard";
    el("view-all-tasks").hidden = view !== "all-tasks";
    if (view === "all-tasks") renderAllTasksTable();
  }

  /* ---------------------------- Task modal ---------------------------- */
  function openModal(mode, taskId) {
    el("modalTitle").textContent = mode === "edit" ? "แก้ไขงาน" : "เพิ่มงานใหม่";
    var form = el("taskForm");
    form.reset();
    if (mode === "edit") {
      var t = state.tasks.find(function (x) { return x.id === taskId; });
      if (!t) return;
      el("taskId").value = t.id;
      el("fTitle").value = t.title;
      el("fCategory").value = t.category || "";
      el("fAssignee").value = t.assignee || "";
      var due = new Date(t.dueDate);
      el("fDate").value = due.getFullYear() + "-" + String(due.getMonth() + 1).padStart(2, "0") + "-" + String(due.getDate()).padStart(2, "0");
      el("fTime").value = fmtTime(due);
      el("fPriority").value = t.priority;
      el("fNotes").value = t.notes || "";
    } else {
      el("taskId").value = "";
      var d = state.selectedDate || dateOnly(now());
      el("fDate").value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      el("fTime").value = "17:00";
      el("fPriority").value = "normal";
    }
    el("modalBackdrop").hidden = false;
  }
  function closeModal() { el("modalBackdrop").hidden = true; }

  /* ---------------------------- Profile modal ---------------------------- */
  function openProfileModal() {
    el("pDisplayName").value = state.profile.displayName;
    el("pAppName").value = state.profile.appName;
    el("profileModalBackdrop").hidden = false;
    el("pDisplayName").focus();
  }
  function closeProfileModal() { el("profileModalBackdrop").hidden = true; }
  function handleProfileSubmit(e) {
    e.preventDefault();
    var displayName = el("pDisplayName").value.trim();
    var appName = el("pAppName").value.trim();
    state.profile = {
      displayName: displayName || DEFAULT_PROFILE.displayName,
      appName: appName || DEFAULT_PROFILE.appName
    };
    saveProfile();
    closeProfileModal();
    renderProfile();
    renderGreeting();
    toast("บันทึกโปรไฟล์แล้ว");
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    var id = el("taskId").value;
    var title = el("fTitle").value.trim();
    var dateStr = el("fDate").value;
    var timeStr = el("fTime").value || "17:00";
    if (!title || !dateStr) return;
    var due = new Date(dateStr + "T" + timeStr + ":00");
    if (isNaN(due.getTime())) { toast("วันที่ไม่ถูกต้อง"); return; }

    var payload = {
      title: title,
      category: el("fCategory").value.trim(),
      assignee: el("fAssignee").value.trim(),
      dueDate: due.toISOString(),
      priority: el("fPriority").value,
      notes: el("fNotes").value.trim()
    };

    try {
      var saved;
      if (id) {
        saved = await apiSend("/api/tasks/" + id, "PUT", payload);
      } else {
        saved = await apiSend("/api/tasks", "POST", payload);
      }
      state.selectedTaskId = saved ? saved.id : null;
      closeModal();
      await refreshAndRender();
      toast("บันทึกงานแล้ว");
    } catch (e2) {
      console.error(e2);
      toast("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
  }

  /* ---------------------------- Export / Import / Reset ---------------------------- */
  function exportData() {
    var blob = new Blob([JSON.stringify(state.tasks, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "duedaily-export-" + fmtDateKey(now()).replace(/-/g, "") + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast("ส่งออกข้อมูลแล้ว");
  }
  function importData(file) {
    var reader = new FileReader();
    reader.onload = async function () {
      // Step 1: parse the file. A failure here really is "invalid file".
      var data;
      try {
        data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error("invalid format");
      } catch (e) {
        console.error(e);
        toast("ไฟล์ไม่ถูกต้อง กรุณาเลือกไฟล์ JSON ที่ส่งออกจาก DueDaily");
        return;
      }
      if (!confirm("นำเข้างาน " + data.length + " รายการ? ข้อมูลปัจจุบันบนเซิร์ฟเวอร์จะถูกแทนที่ทั้งหมด")) return;
      // Step 2: send to server. A failure here means the server isn't reachable —
      // a different problem from "bad file", so give a distinct, actionable message.
      try {
        await apiSend("/api/tasks/import", "POST", { tasks: data });
        state.selectedTaskId = null;
        await refreshAndRender();
        toast("นำเข้าข้อมูลสำเร็จ");
      } catch (e) {
        console.error(e);
        setServerWarning(true);
        toast("นำเข้าข้อมูลไม่สำเร็จ: เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (ดูคำแนะนำแถบสีแดงด้านบน)");
      }
    };
    reader.readAsText(file);
  }
  async function resetData() {
    if (!confirm("ล้างข้อมูลงานทั้งหมดบนเซิร์ฟเวอร์นี้? การลบไม่สามารถย้อนกลับได้")) return;
    try {
      await apiSend("/api/tasks", "DELETE");
      state.selectedTaskId = null;
      await refreshAndRender();
      toast("ล้างข้อมูลทั้งหมดแล้ว");
    } catch (e) {
      console.error(e);
      toast("ล้างข้อมูลไม่สำเร็จ");
    }
  }

  /* ---------------------------- Toast ---------------------------- */
  var toastTimer = null;
  function toast(msg) {
    var elToast = el("toast");
    elToast.textContent = msg;
    elToast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.hidden = true; }, 2600);
  }

  /* ---------------------------- Push notifications ---------------------------- */
  var PUSH_SUPPORTED = ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window);

  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }
  function isStandaloneDisplay() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }

  function registerSW() {
    if (!PUSH_SUPPORTED) return Promise.resolve(null);
    return navigator.serviceWorker.register("/sw.js").catch(function (e) {
      console.error("SW register failed:", e);
      return null;
    });
  }
  async function getExistingSubscription() {
    if (!PUSH_SUPPORTED) return null;
    var reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return reg.pushManager.getSubscription();
  }

  async function refreshPushStatusUI() {
    var line = el("pushStatusLine");
    var enableBtn = el("pushEnableBtn");
    var disableBtn = el("pushDisableBtn");
    var testBtn = el("pushTestBtn");
    var navDot = el("pushNavDot");
    if (!line) return;

    if (!PUSH_SUPPORTED) {
      line.textContent = "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนแบบพุช";
      line.className = "push-status off";
      enableBtn.hidden = true; disableBtn.hidden = true; testBtn.hidden = true;
      navDot.hidden = true;
      return;
    }

    var sub = null;
    try { sub = await getExistingSubscription(); } catch (e) { /* ignore */ }
    var permission = Notification.permission;

    if (sub && permission === "granted") {
      line.textContent = "เปิดใช้งานการแจ้งเตือนบนเครื่องนี้แล้ว ✓";
      line.className = "push-status";
      enableBtn.hidden = true; disableBtn.hidden = false; testBtn.hidden = false;
      navDot.hidden = true;
    } else if (permission === "denied") {
      line.textContent = "การแจ้งเตือนถูกปิดกั้นในตั้งค่า กรุณาเปิดสิทธิ์แจ้งเตือนให้เว็บนี้ในตั้งค่าเครื่อง/เบราว์เซอร์ก่อน";
      line.className = "push-status warn";
      enableBtn.hidden = false; disableBtn.hidden = true; testBtn.hidden = true;
      navDot.hidden = false;
    } else {
      line.textContent = "ยังไม่ได้เปิดการแจ้งเตือนบนเครื่องนี้";
      line.className = "push-status off";
      enableBtn.hidden = false; disableBtn.hidden = true; testBtn.hidden = true;
      navDot.hidden = false;
    }
  }

  async function enablePush() {
    if (!PUSH_SUPPORTED) { toast("เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน"); return; }
    if (isIOS() && !isStandaloneDisplay()) {
      toast('บน iPhone ต้อง "เพิ่มไปยังหน้าจอโฮม" ก่อน แล้วเปิดแอปจากไอคอนนั้น (ดูขั้นตอนด้านล่าง)');
      return;
    }
    try {
      var reg = await registerSW();
      if (!reg) { toast("ลงทะเบียน Service Worker ไม่สำเร็จ"); return; }
      var permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast("ไม่ได้รับสิทธิ์แจ้งเตือน");
        await refreshPushStatusUI();
        return;
      }
      var keyRes = await fetch("/api/vapid-public-key");
      var keyData = await keyRes.json();
      var existing = await reg.pushManager.getSubscription();
      var sub = existing || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
      });
      await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub)
      });
      toast("เปิดการแจ้งเตือนสำเร็จ 🎉");
    } catch (e) {
      console.error(e);
      toast("เปิดการแจ้งเตือนไม่สำเร็จ: " + (e && e.message ? e.message : "unknown error"));
    }
    await refreshPushStatusUI();
  }

  async function disablePush() {
    try {
      var sub = await getExistingSubscription();
      if (sub) {
        await fetch("/api/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
        await sub.unsubscribe();
      }
      toast("ปิดการแจ้งเตือนบนเครื่องนี้แล้ว");
    } catch (e) {
      console.error(e);
      toast("ปิดการแจ้งเตือนไม่สำเร็จ");
    }
    await refreshPushStatusUI();
  }

  async function sendTestPush() {
    try {
      var res = await fetch("/api/test-notification", { method: "POST" });
      var data = await res.json();
      toast("ส่งการแจ้งเตือนทดสอบแล้ว (" + (data.sent || 0) + " อุปกรณ์)");
    } catch (e) {
      console.error(e);
      toast("ส่งการแจ้งเตือนทดสอบไม่สำเร็จ");
    }
  }

  function openPushModal() { el("pushModalBackdrop").hidden = false; refreshPushStatusUI(); }
  function closePushModal() { el("pushModalBackdrop").hidden = true; }

  /* ---------------------------- Wire up events ---------------------------- */
  async function init() {
    state.profile = loadProfile() || Object.assign({}, DEFAULT_PROFILE);
    await loadTasksFromServer();

    // pick a sensible default selected task: most urgent active one
    var initial = sortTasks(activeTasks(), false)[0];
    state.selectedTaskId = initial ? initial.id : null;

    document.querySelectorAll(".nav-item[data-view]").forEach(function (n) {
      n.addEventListener("click", function () { setView(n.getAttribute("data-view")); });
    });
    document.querySelector('.nav-item[data-action="add-task"]').addEventListener("click", function () { openModal("add"); });
    el("addBtnTop").addEventListener("click", function () { openModal("add"); });
    document.querySelector('.show-all[data-view="all-tasks"]').addEventListener("click", function () { setView("all-tasks"); });

    el("userAvatar").addEventListener("click", openProfileModal);
    el("profileForm").addEventListener("submit", handleProfileSubmit);
    el("profileModalClose").addEventListener("click", closeProfileModal);
    el("profileModalCancel").addEventListener("click", closeProfileModal);
    el("profileModalBackdrop").addEventListener("click", function (e) { if (e.target === el("profileModalBackdrop")) closeProfileModal(); });

    document.querySelector('[data-action="push-settings"]').addEventListener("click", openPushModal);
    el("pushModalClose").addEventListener("click", closePushModal);
    el("pushModalBackdrop").addEventListener("click", function (e) { if (e.target === el("pushModalBackdrop")) closePushModal(); });
    el("pushEnableBtn").addEventListener("click", enablePush);
    el("pushDisableBtn").addEventListener("click", disablePush);
    el("pushTestBtn").addEventListener("click", sendTestPush);

    var retryBtn = el("serverWarningRetry");
    if (retryBtn) retryBtn.addEventListener("click", function () { refreshAndRender(); });

    document.querySelector('[data-action="export"]').addEventListener("click", exportData);
    el("importFile").addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    });
    document.querySelector('[data-action="reset"]').addEventListener("click", resetData);

    el("searchInput").addEventListener("input", function (e) {
      state.searchQuery = e.target.value;
      renderTaskList();
      if (state.view === "all-tasks") renderAllTasksTable();
    });
    el("filterPills").querySelectorAll(".pill").forEach(function (p) {
      p.addEventListener("click", function () {
        el("filterPills").querySelectorAll(".pill").forEach(function (x) { x.classList.remove("active"); });
        p.classList.add("active");
        state.pillFilter = p.getAttribute("data-filter");
        renderTaskList();
        if (state.view === "all-tasks") renderAllTasksTable();
      });
    });

    el("sortToggle").addEventListener("click", function () {
      state.sortByPriority = !state.sortByPriority;
      renderTaskList();
    });

    el("bellBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      el("bellPanel").classList.toggle("open");
    });
    document.addEventListener("click", function (e) {
      var bellWrap = el("bellBtn");
      if (bellWrap && !bellWrap.contains(e.target)) el("bellPanel").classList.remove("open");
    });

    el("calPrev").addEventListener("click", function () {
      state.calMonth--;
      if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
      renderCalendar();
    });
    el("calNext").addEventListener("click", function () {
      state.calMonth++;
      if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
      renderCalendar();
    });
    el("calTodayBtn").addEventListener("click", function () {
      var t = dateOnly(now());
      state.calYear = t.getFullYear();
      state.calMonth = t.getMonth();
      state.selectedDate = t;
      renderCalendar();
      renderTimeline();
    });
    el("calAddBtn").addEventListener("click", function () { openModal("add"); });

    el("showDoneToggle").addEventListener("change", function (e) {
      state.showDoneInTable = e.target.checked;
      renderAllTasksTable();
    });

    el("taskForm").addEventListener("submit", handleFormSubmit);
    el("modalClose").addEventListener("click", closeModal);
    el("modalCancel").addEventListener("click", closeModal);
    el("modalBackdrop").addEventListener("click", function (e) { if (e.target === el("modalBackdrop")) closeModal(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !el("modalBackdrop").hidden) closeModal();
      if (e.key === "Escape" && !el("profileModalBackdrop").hidden) closeProfileModal();
      if (e.key === "Escape" && !el("pushModalBackdrop").hidden) closePushModal();
    });

    renderAll();
    setView("dashboard");
    registerSW();
    refreshPushStatusUI();

    // Keep relative times / statuses fresh, and pick up server-side changes.
    setInterval(refreshAndRender, 60000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refreshAndRender();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
