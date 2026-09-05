const STORAGE_KEY = "pago-libertad-state-v1";
const NOTIFIED_KEY = "pago-libertad-notified";
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

function reminderDate(payDate) {
  return new Date(payDate.getFullYear(), payDate.getMonth(), payDate.getDate());
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
        reminder: reminderDate(payDate),
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
      const amount = state.pagoQuincenal
        ? ` Monto sugerido: ${formatMoney(state.pagoQuincenal)}.`
        : "";
      return [
        "BEGIN:VEVENT",
        `UID:libertad-${toYmd(cycle.payDate)}@pagolibertad`,
        `DTSTAMP:${icsDate(today)}T150000Z`,
        `DTSTART;VALUE=DATE:${icsDate(cycle.payDate)}`,
        `DTEND;VALUE=DATE:${icsDate(addDays(cycle.payDate, 1))}`,
        "SUMMARY:Pago Libertad — quincena",
        `DESCRIPTION:Hoy es tu quincena. Fecha de pago: ${longDate.format(cycle.payDate)}.${amount}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:PT9H",
        "DESCRIPTION:Hoy pagas tu deuda",
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
    const movedText = cycle.moved
      ? `La quincena oficial es ${longDate.format(cycle.official)}, así que el pago se recorre a ${longDate.format(cycle.payDate)}.`
      : `Pagas el ${longDate.format(cycle.payDate)}.`;
    $("cycle-title").textContent = longDate.format(cycle.payDate);
    $("cycle-detail").textContent = `${movedText} El aviso es el mismo día.`;
    $("cycle-eta").textContent = state.pagoQuincenal
      ? `Sugerido esta quincena: ${formatMoney(state.pagoQuincenal)}.`
      : "Registra el monto que pagues esta quincena.";

    const upcoming = $("upcoming-list");
    if (upcoming) {
      const now = startOfDay(new Date());
      upcoming.innerHTML = upcomingCycles(now)
        .filter((item) => startOfDay(item.payDate) >= now)
        .slice(0, 6)
        .map((item) => {
          if (item.moved) {
            return `<li>${longDate.format(item.official)} → pagas y aviso: ${longDate.format(item.payDate)}.</li>`;
          }
          return `<li>Pagas y aviso: ${longDate.format(item.payDate)}.</li>`;
        })
        .join("");
    }
  }

  const banner = $("cycle-banner");
  if (progress >= 1) {
    banner.hidden = false;
    banner.innerHTML = "<strong>Eres libre.</strong><span>Tu deuda llegó a cero.</span>";
  } else if (bannerCycle) {
    banner.hidden = false;
    banner.innerHTML =
      "<strong>Hoy es quincena.</strong><span>Registra tu pago para que el muñequito avance.</span>";
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
              <strong>${formatMoney(pago.monto)}</strong>
              <small>${longDate.format(fromYmd(pago.fecha))}${pago.nota ? ` · ${pago.nota}` : ""}</small>
            </div>
            <button type="button" data-delete="${pago.id}">Borrar</button>
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
  const body = `Hoy es tu quincena. Pagas el ${longDate.format(cycle.payDate)}.`;
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
    $("payment-form").fecha.value = toYmd(cycle?.payDate || new Date());
    $("payment-form").monto.value = state.pagoQuincenal || "";
    $("payment-modal").hidden = false;
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
