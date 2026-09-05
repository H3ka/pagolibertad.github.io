const STORAGE_KEY = "pago-libertad-state-v1";
const NOTIFIED_KEY = "pago-libertad-notified";

/** Plan fijo 2026: montos por tarjeta en cada quincena. */
const PAYMENT_PLAN = [
  { id: "2026-09-15-amex", fecha: "2026-09-15", tarjeta: "AMEX", monto: 2274.21 },
  { id: "2026-09-15-nu", fecha: "2026-09-15", tarjeta: "NU", monto: 1431.2 },
  { id: "2026-09-15-suburbia", fecha: "2026-09-15", tarjeta: "SUBURBIA", monto: 224.4 },
  { id: "2026-09-15-bbva", fecha: "2026-09-15", tarjeta: "BBVA", monto: 5220.19 },
  { id: "2026-09-30-bbva", fecha: "2026-09-30", tarjeta: "BBVA", monto: 3146.44 },
  { id: "2026-09-30-banamex", fecha: "2026-09-30", tarjeta: "BANAMEX", monto: 6003.56 },
  { id: "2026-10-15-banamex", fecha: "2026-10-15", tarjeta: "BANAMEX", monto: 8846.08 },
  { id: "2026-10-15-amex", fecha: "2026-10-15", tarjeta: "AMEX", monto: 303.92 },
  { id: "2026-10-30-amex", fecha: "2026-10-30", tarjeta: "AMEX", monto: 9150 },
  { id: "2026-11-15-amex", fecha: "2026-11-15", tarjeta: "AMEX", monto: 1771.87 },
  { id: "2026-11-15-mp", fecha: "2026-11-15", tarjeta: "MercadoPago", monto: 7378.13 },
  { id: "2026-11-30-mp", fecha: "2026-11-30", tarjeta: "MercadoPago", monto: 4620.22 }
];

const PLAN_TOTAL = PAYMENT_PLAN.reduce((sum, item) => sum + item.monto, 0);
const PLAN_QUINCENAL = 9150;

function formatMoney(value) {
  const amount = Number(value) || 0;
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
}
const longDate = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  day: "numeric",
  month: "long"
});

const defaultState = () => ({
  deudaTotal: 0,
  pagoQuincenal: 0,
  pagos: []
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed,
      pagos: Array.isArray(parsed.pagos) ? parsed.pagos : []
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortPlanDate(ymd) {
  const date = fromYmd(ymd);
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(date);
}

function planPayDate(ymd) {
  return adjustPayDate(fromYmd(ymd));
}

function planItemDone(state, item) {
  return state.pagos.some(
    (pago) =>
      pago.planId === item.id ||
      (pago.nota === item.tarjeta &&
        Number(pago.monto) === item.monto &&
        Math.abs(fromYmd(pago.fecha) - planPayDate(item.fecha)) < 1000 * 60 * 60 * 24 * 8)
  );
}

function planForOfficialDate(ymd) {
  return PAYMENT_PLAN.filter((item) => item.fecha === ymd);
}

function planTotalForOfficialDate(ymd) {
  return planForOfficialDate(ymd).reduce((sum, item) => sum + item.monto, 0);
}

function parseMoney(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[$\s]/g, "")
    .replace(/,/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toYmd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromYmd(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

function quincenaDatesInMonth(year, month) {
  return [new Date(year, month, 15), lastDayOfMonth(year, month)];
}

function adjustPayDate(date) {
  const adjusted = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = adjusted.getDay();
  const offset = day === 1 ? 4 : day === 6 ? 2 : day === 0 ? 3 : 0;
  if (offset) adjusted.setDate(adjusted.getDate() - offset);
  return adjusted;
}

function reminderDate(official, payDate) {
  const day = official.getDay();
  // Sábado, domingo o lunes: pago y aviso el jueves anterior.
  if (day === 0 || day === 1 || day === 6) {
    return new Date(payDate.getFullYear(), payDate.getMonth(), payDate.getDate());
  }
  // Resto: aviso un día antes de la quincena.
  return addDays(payDate, -1);
}

function upcomingCycles(fromDate, count = 24) {
  const cycles = [];
  const start = new Date(fromDate.getFullYear(), fromDate.getMonth() - 1, 1);

  for (let i = 0; i < count; i += 1) {
    const cursor = new Date(start.getFullYear(), start.getMonth() + i, 1);
    for (const official of quincenaDatesInMonth(cursor.getFullYear(), cursor.getMonth())) {
      const payDate = adjustPayDate(official);
      cycles.push({
        official,
        payDate,
        reminder: reminderDate(official, payDate),
        moved: toYmd(official) !== toYmd(payDate)
      });
    }
  }

  return cycles.sort((a, b) => a.payDate - b.payDate);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextCycle(today = new Date()) {
  const now = startOfDay(today);
  return upcomingCycles(now).find((cycle) => startOfDay(cycle.payDate) >= now);
}

function currentBannerCycle(today = new Date()) {
  const now = startOfDay(today);
  return upcomingCycles(now).find((cycle) => startOfDay(cycle.reminder) <= now && startOfDay(cycle.payDate) >= now);
}

function paidTotal(state) {
  return state.pagos.reduce((sum, pago) => sum + Number(pago.monto || 0), 0);
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function icsDate(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function buildCalendar(state) {
  const today = startOfDay(new Date());
  const events = upcomingCycles(today, 14)
    .filter((cycle) => cycle.reminder >= today)
    .slice(0, 24)
    .map((cycle) => {
      const planSum = planTotalForOfficialDate(toYmd(cycle.official));
      const amount = planSum
        ? ` Monto del plan: ${formatMoney(planSum)}.`
        : state.pagoQuincenal
          ? ` Monto sugerido: ${formatMoney(state.pagoQuincenal)}.`
          : "";
      const sameDay = toYmd(cycle.reminder) === toYmd(cycle.payDate);
      const summary = sameDay
        ? "Pago Libertad — hoy es quincena"
        : "Pago Libertad — mañana es quincena";
      const description = sameDay
        ? `Hoy pagas tu deuda (${longDate.format(cycle.payDate)}).${amount}`
        : `Mañana pagas tu deuda (${longDate.format(cycle.payDate)}).${amount}`;
      const alarm = sameDay ? "Hoy pagas tu deuda" : "Mañana pagas tu deuda";
      return [
        "BEGIN:VEVENT",
        `UID:libertad-${toYmd(cycle.reminder)}@pagolibertad`,
        `DTSTAMP:${icsDate(today)}T150000Z`,
        `DTSTART;VALUE=DATE:${icsDate(cycle.reminder)}`,
        `DTEND;VALUE=DATE:${icsDate(addDays(cycle.reminder, 1))}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:PT9H",
        `DESCRIPTION:${alarm}`,
        "END:VALARM",
        "END:VEVENT"
      ].join("\r\n");
    });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pago Libertad//ES",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR"
  ].join("\r\n");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function $(id) {
  return document.getElementById(id);
}

function render(state) {
  const total = Number(state.deudaTotal) || 0;
  const paid = Math.min(paidTotal(state), total || paidTotal(state));
  const remaining = Math.max(total - paid, 0);
  const progress = total > 0 ? Math.min(paid / total, 1) : 0;
  const percent = Math.round(progress * 100);
  const cycle = nextCycle();
  const bannerCycle = currentBannerCycle();

  $("stat-total").textContent = formatMoney(total);
  $("stat-paid").textContent = formatMoney(paid);
  $("stat-remaining").textContent = formatMoney(remaining);
  $("percent-label").textContent = `${percent}%`;
  $("path-fill").style.width = `${progress * 100}%`;
  $("walker").style.left = `calc(18px + (100% - 36px) * ${progress})`;
  $("scene").classList.toggle("is-free", progress >= 1);

  if (!total) {
    $("progress-caption").textContent = "Empieza por registrar tu deuda.";
  } else if (progress >= 1) {
    $("progress-caption").textContent = "Llegaste a la libertad. Ya no debes nada.";
  } else if (state.pagoQuincenal) {
    const left = Math.ceil(remaining / state.pagoQuincenal);
    $("progress-caption").textContent = `Te faltan ${left} quincena${left === 1 ? "" : "s"} si mantienes ${formatMoney(state.pagoQuincenal)}.`;
  } else {
    $("progress-caption").textContent = "Cada pago acerca al muñequito a la puerta de la libertad.";
  }

  if (cycle) {
    $("cycle-title").textContent = longDate.format(cycle.payDate);

    const officialYmd = toYmd(cycle.official);
    const planItems = planForOfficialDate(officialYmd);
    const planSum = planTotalForOfficialDate(officialYmd);
    const cards = $("cycle-cards");

    if (planItems.length) {
      $("cycle-eta").textContent = `Próximo pago: ${formatMoney(planSum)}`;
      cards.innerHTML = planItems
        .map(
          (item) =>
            `<li><span>${escapeHtml(item.tarjeta)}</span><strong>${escapeHtml(formatMoney(item.monto))}</strong></li>`
        )
        .join("");
    } else if (state.pagoQuincenal) {
      $("cycle-eta").textContent = `Próximo pago: ${formatMoney(state.pagoQuincenal)}`;
      cards.innerHTML = "";
    } else {
      $("cycle-eta").textContent = "Registra el monto que pagues esta quincena.";
      cards.innerHTML = "";
    }
  }

  const planBody = $("plan-body");
  const planDone = PAYMENT_PLAN.filter((item) => planItemDone(state, item)).length;
  $("plan-count").textContent = `${planDone}/${PAYMENT_PLAN.length}`;
  $("plan-summary").textContent = `Total del plan: ${formatMoney(PLAN_TOTAL)}. Quincenas de ${formatMoney(PLAN_QUINCENAL)} (excepto 30 nov).`;

  let lastFecha = "";
  planBody.innerHTML = PAYMENT_PLAN.map((item) => {
    const done = planItemDone(state, item);
    const showDate = item.fecha !== lastFecha;
    lastFecha = item.fecha;
    const payDate = planPayDate(item.fecha);
    const moved = toYmd(payDate) !== item.fecha;
    const dateLabel = moved
      ? `${shortPlanDate(item.fecha)} → ${shortPlanDate(toYmd(payDate))}`
      : shortPlanDate(item.fecha);
    return `
      <tr class="${done ? "is-done" : ""}" data-plan-id="${escapeHtml(item.id)}">
        <td class="date-cell">${showDate ? escapeHtml(dateLabel) : ""}</td>
        <td>${escapeHtml(item.tarjeta)}</td>
        <td class="num">${escapeHtml(formatMoney(item.monto))}</td>
        <td>${
          done
            ? '<span class="done-label">Pagado</span>'
            : `<button class="btn btn-mini" type="button" data-plan-pay="${escapeHtml(item.id)}">Pagar</button>`
        }</td>
      </tr>`;
  }).join("");

  const banner = $("cycle-banner");
  if (progress >= 1) {
    banner.hidden = false;
    banner.innerHTML = "<strong>Eres libre.</strong><span>Tu deuda llegó a cero.</span>";
  } else if (bannerCycle) {
    const today = toYmd(new Date());
    const isReminderOnly = toYmd(bannerCycle.reminder) === today && toYmd(bannerCycle.payDate) !== today;
    banner.hidden = false;
    banner.innerHTML = isReminderOnly
      ? `<strong>Mañana pagas tu deuda.</strong><span>Fecha de pago: ${longDate.format(bannerCycle.payDate)}.</span>`
      : "<strong>Hoy es quincena.</strong><span>Registra tu pago para que el muñequito avance.</span>";
  } else {
    banner.hidden = true;
  }

  const list = $("payments-list");
  const pagos = [...state.pagos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  $("payments-count").textContent = String(pagos.length);
  if (!pagos.length) {
    list.innerHTML = '<li class="empty">Aún no hay pagos registrados.</li>';
  } else {
    list.innerHTML = pagos
      .map(
        (pago) => `
          <li>
            <div>
              <strong>${escapeHtml(formatMoney(pago.monto))}</strong>
              <small>${escapeHtml(longDate.format(fromYmd(pago.fecha)))}${
                pago.nota ? ` · ${escapeHtml(pago.nota)}` : ""
              }</small>
            </div>
            <button type="button" data-delete="${escapeHtml(pago.id)}">Borrar</button>
          </li>`
      )
      .join("");
  }

  $("settings-form").deudaTotal.value = state.deudaTotal || "";
  $("settings-form").pagoQuincenal.value = state.pagoQuincenal || "";
  $("setup-modal").hidden = total > 0;
}

async function maybeNotify(state) {
  const cycle = currentBannerCycle();
  if (!cycle || paidTotal(state) >= state.deudaTotal) return;
  if (Notification.permission !== "granted") return;

  const today = toYmd(new Date());
  if (toYmd(cycle.reminder) !== today) return;

  const last = localStorage.getItem(NOTIFIED_KEY);
  if (last === today) return;

  const registration = await navigator.serviceWorker?.ready.catch(() => null);
  const title = "Pago Libertad";
  const sameDay = toYmd(cycle.reminder) === toYmd(cycle.payDate);
  const body = sameDay
    ? `Hoy es tu quincena. Pagas el ${longDate.format(cycle.payDate)}.`
    : `Mañana es tu quincena. Pagas el ${longDate.format(cycle.payDate)}.`;
  if (registration?.showNotification) {
    await registration.showNotification(title, { body, icon: "./icons/icon-192.png" });
  } else {
    new Notification(title, { body });
  }
  localStorage.setItem(NOTIFIED_KEY, today);
}

function bind(state) {
  $("setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const deudaTotal = parseMoney(event.target.deudaTotal.value);
    const pagoQuincenal = parseMoney(event.target.pagoQuincenal.value) ?? 0;
    if (deudaTotal === null || deudaTotal <= 0) return;
    state.deudaTotal = deudaTotal;
    state.pagoQuincenal = pagoQuincenal;
    saveState(state);
    render(state);
  });

  $("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const deudaTotal = parseMoney(event.target.deudaTotal.value);
    const pagoQuincenal = parseMoney(event.target.pagoQuincenal.value) ?? 0;
    if (deudaTotal === null || deudaTotal <= 0) return;
    state.deudaTotal = deudaTotal;
    state.pagoQuincenal = pagoQuincenal;
    saveState(state);
    render(state);
    $("settings-modal").hidden = true;
  });

  $("payment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const monto = parseMoney(event.target.monto.value);
    const fecha = event.target.fecha.value;
    if (monto === null || monto <= 0 || !fecha) return;
    state.pagos.push({
      id: uid(),
      monto,
      fecha,
      nota: event.target.nota.value.trim()
    });
    saveState(state);
    render(state);
    $("payment-modal").hidden = true;
    event.target.reset();
  });

  $("add-payment").addEventListener("click", () => {
    const cycle = nextCycle();
    const planSum = cycle ? planTotalForOfficialDate(toYmd(cycle.official)) : 0;
    $("payment-form").fecha.value = toYmd(cycle?.payDate || new Date());
    $("payment-form").monto.value = planSum || state.pagoQuincenal || PLAN_QUINCENAL;
    $("payment-form").nota.value = "";
    $("payment-modal").hidden = false;
  });

  $("plan-body").addEventListener("click", (event) => {
    const planId = event.target.dataset?.planPay;
    if (!planId) return;
    const item = PAYMENT_PLAN.find((entry) => entry.id === planId);
    if (!item || planItemDone(state, item)) return;
    state.pagos.push({
      id: uid(),
      planId: item.id,
      monto: item.monto,
      fecha: toYmd(planPayDate(item.fecha)),
      nota: item.tarjeta
    });
    saveState(state);
    render(state);
  });

  $("cancel-payment").addEventListener("click", () => {
    $("payment-modal").hidden = true;
  });

  $("open-settings").addEventListener("click", () => {
    $("settings-modal").hidden = false;
  });

  $("close-settings").addEventListener("click", () => {
    $("settings-modal").hidden = true;
  });

  $("add-calendar").addEventListener("click", () => {
    downloadFile("pago-libertad-recordatorios.ics", buildCalendar(state), "text/calendar");
  });

  $("export-data").addEventListener("click", () => {
    downloadFile("pago-libertad-respaldo.json", JSON.stringify(state, null, 2), "application/json");
  });

  $("import-data").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      state.deudaTotal = Number(parsed.deudaTotal) || 0;
      state.pagoQuincenal = Number(parsed.pagoQuincenal) || 0;
      state.pagos = Array.isArray(parsed.pagos) ? parsed.pagos : [];
      saveState(state);
      render(state);
      $("settings-modal").hidden = true;
    } catch {
      alert("No se pudo leer ese respaldo.");
    }
  });

  $("reset-data").addEventListener("click", () => {
    if (!confirm("Esto borra tu deuda y todos los pagos.")) return;
    localStorage.removeItem(STORAGE_KEY);
    Object.assign(state, defaultState());
    render(state);
    $("settings-modal").hidden = true;
  });

  $("enable-alerts").addEventListener("click", async () => {
    if (!("Notification" in window)) {
      alert("Este iPhone no permite avisos web. Usa el calendario, que sí llega seguro.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      await maybeNotify(state);
      alert("Listo. Si abres la app el día del recordatorio, te avisará.");
    }
  });

  $("payments-list").addEventListener("click", (event) => {
    const id = event.target.dataset?.delete;
    if (!id) return;
    state.pagos = state.pagos.filter((pago) => pago.id !== id);
    saveState(state);
    render(state);
  });
}

async function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch {
    // Local files or unsupported browsers can skip offline caching.
  }
}

const state = loadState();
bind(state);
render(state);
registerWorker();
maybeNotify(state);
