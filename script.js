const emptyState = {
  trip: {
    name: "",
    destination: "",
    pace: "balanced",
    startDate: "",
    endDate: "",
    budget: 0,
    currency: "CNY",
    notes: ""
  },
  entries: []
};

const tripForm = document.getElementById("trip-form");
const entryForm = document.getElementById("entry-form");
const tripNameInput = document.getElementById("trip-name");
const tripDestinationInput = document.getElementById("trip-destination");
const tripPaceInput = document.getElementById("trip-pace");
const tripStartInput = document.getElementById("trip-start");
const tripEndInput = document.getElementById("trip-end");
const tripBudgetInput = document.getElementById("trip-budget");
const tripCurrencyInput = document.getElementById("trip-currency");
const tripNotesInput = document.getElementById("trip-notes");
const entryDayInput = document.getElementById("entry-day");
const entryTimeInput = document.getElementById("entry-time");
const entryTitleInput = document.getElementById("entry-title");
const entryPlaceInput = document.getElementById("entry-place");
const entryTypeInput = document.getElementById("entry-type");
const entryCostInput = document.getElementById("entry-cost");
const entryStatusInput = document.getElementById("entry-status");
const entryNotesInput = document.getElementById("entry-notes");
const tripDateRange = document.getElementById("trip-date-range");
const tripTitleDisplay = document.getElementById("trip-title-display");
const tripPaceDisplay = document.getElementById("trip-pace-display");
const statDays = document.getElementById("stat-days");
const statItems = document.getElementById("stat-items");
const statBudget = document.getElementById("stat-budget");
const destinationDisplay = document.getElementById("destination-display");
const tripNotesDisplay = document.getElementById("trip-notes-display");
const confirmedCount = document.getElementById("confirmed-count");
const dayTabs = document.getElementById("day-tabs");
const timeline = document.getElementById("timeline");
const resetTripButton = document.getElementById("reset-trip");
const importTripButton = document.getElementById("import-trip");
const exportTripButton = document.getElementById("export-trip");
const importFileInput = document.getElementById("import-file");
const clearDayButton = document.getElementById("clear-day");
const timelineTemplate = document.getElementById("timeline-item-template");

let state = structuredClone(emptyState);
let activeDay = 1;

function sanitizeImportedState(input) {
  const trip = input && typeof input === "object" && input.trip && typeof input.trip === "object"
    ? input.trip
    : {};
  const entries = input && typeof input === "object" && Array.isArray(input.entries)
    ? input.entries
    : [];

  return {
    trip: {
      name: typeof trip.name === "string" ? trip.name : "",
      destination: typeof trip.destination === "string" ? trip.destination : "",
      pace: ["slow", "balanced", "packed"].includes(trip.pace) ? trip.pace : "balanced",
      startDate: typeof trip.startDate === "string" ? trip.startDate : "",
      endDate: typeof trip.endDate === "string" ? trip.endDate : "",
      budget: Number(trip.budget) || 0,
      currency: typeof trip.currency === "string" && trip.currency.trim() ? trip.currency.trim().toUpperCase() : "CNY",
      notes: typeof trip.notes === "string" ? trip.notes : ""
    },
    entries: entries.map((entry) => ({
      id: typeof entry.id === "string" && entry.id ? entry.id : createId(),
      day: Math.max(1, Number(entry.day) || 1),
      time: typeof entry.time === "string" ? entry.time : "",
      title: typeof entry.title === "string" ? entry.title : "",
      place: typeof entry.place === "string" ? entry.place : "",
      type: ["sightseeing", "food", "stay", "transport", "shopping", "rest"].includes(entry.type) ? entry.type : "sightseeing",
      cost: Number(entry.cost) || 0,
      status: ["idea", "booked", "confirmed"].includes(entry.status) ? entry.status : "idea",
      notes: typeof entry.notes === "string" ? entry.notes : ""
    })).filter((entry) => entry.title)
  };
}

function normalizeEntriesToTrip() {
  const maxDay = tripDaysCount();
  state.entries = state.entries.map((entry) => ({
    ...entry,
    day: Math.min(Math.max(Number(entry.day) || 1, 1), maxDay)
  }));
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `entry-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function paceLabel(pace) {
  return {
    slow: "慢游",
    balanced: "平衡",
    packed: "高密度"
  }[pace] || "平衡";
}

function typeLabel(type) {
  return {
    sightseeing: "观光",
    food: "餐饮",
    stay: "住宿",
    transport: "交通",
    shopping: "购物",
    rest: "休息"
  }[type] || "行程";
}

function statusLabel(status) {
  return {
    idea: "灵感",
    booked: "已预订",
    confirmed: "已确认"
  }[status] || "灵感";
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tripDaysCount() {
  const start = parseDate(state.trip.startDate);
  const end = parseDate(state.trip.endDate);

  if (!start || !end || end < start) {
    return 1;
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end - start) / msPerDay) + 1;
}

function formatDateRange() {
  const start = parseDate(state.trip.startDate);
  const end = parseDate(state.trip.endDate);

  if (!start || !end || end < start) {
    return "还没有设置出行日期";
  }

  const formatter = new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric"
  });

  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatCurrency(amount) {
  const currency = (state.trip.currency || "CNY").toUpperCase();
  const numericAmount = Number(amount) || 0;
  return `${currency} ${numericAmount}`;
}

function usedBudget() {
  return state.entries.reduce((sum, entry) => sum + (Number(entry.cost) || 0), 0);
}

function entryMeta(entry) {
  const parts = [];

  if (entry.place) {
    parts.push(entry.place);
  }

  parts.push(typeLabel(entry.type));
  parts.push(statusLabel(entry.status));

  if (Number(entry.cost) > 0) {
    parts.push(formatCurrency(entry.cost));
  }

  return parts.join(" | ");
}

function entriesForDay(day) {
  return [...state.entries]
    .filter((entry) => entry.day === day)
    .sort((a, b) => {
      if (!!a.time !== !!b.time) {
        return a.time ? -1 : 1;
      }

      if (a.time !== b.time) {
        return a.time.localeCompare(b.time);
      }

      return a.title.localeCompare(b.title, "zh-CN");
    });
}

function fillTripForm() {
  tripNameInput.value = state.trip.name || "";
  tripDestinationInput.value = state.trip.destination || "";
  tripPaceInput.value = state.trip.pace || "balanced";
  tripStartInput.value = state.trip.startDate || "";
  tripEndInput.value = state.trip.endDate || "";
  tripBudgetInput.value = state.trip.budget || "";
  tripCurrencyInput.value = state.trip.currency || "CNY";
  tripNotesInput.value = state.trip.notes || "";
}

function syncDayOptions() {
  const dayCount = tripDaysCount();
  const currentValue = Number(entryDayInput.value) || activeDay;

  entryDayInput.innerHTML = "";
  dayTabs.innerHTML = "";

  for (let day = 1; day <= dayCount; day += 1) {
    const option = document.createElement("option");
    option.value = String(day);
    option.textContent = `Day ${day}`;
    entryDayInput.appendChild(option);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "day-tab";
    button.dataset.day = String(day);
    button.textContent = `Day ${day}`;
    button.addEventListener("click", () => {
      activeDay = day;
      entryDayInput.value = String(day);
      render();
    });
    dayTabs.appendChild(button);
  }

  activeDay = Math.min(Math.max(currentValue, 1), dayCount);
  entryDayInput.value = String(activeDay);
}

function renderSummary() {
  const totalDays = tripDaysCount();
  const totalEntries = state.entries.length;
  const bookedEntries = state.entries.filter((entry) => entry.status === "confirmed" || entry.status === "booked").length;
  const budget = Number(state.trip.budget) || 0;
  const spent = usedBudget();
  const budgetPercent = budget <= 0 ? 0 : Math.min(999, Math.round((spent / budget) * 100));

  tripDateRange.textContent = formatDateRange();
  tripTitleDisplay.textContent = state.trip.name || "下一次旅行，从这里开始。";
  tripPaceDisplay.textContent = state.trip.destination
    ? `${state.trip.destination} · ${paceLabel(state.trip.pace)}节奏 · ${totalDays} 天`
    : "先填写目的地和日期，网站会自动生成每日行程视图。";

  statDays.textContent = String(totalDays);
  statItems.textContent = String(totalEntries);
  statBudget.textContent = `${budgetPercent}%`;
  destinationDisplay.textContent = state.trip.destination || "待设定";
  tripNotesDisplay.textContent = state.trip.notes || "补充一些旅行期待，页面会把它放在这里作为主线提醒。";
  confirmedCount.textContent = String(bookedEntries);
}

function renderTimeline() {
  timeline.innerHTML = "";

  for (const button of dayTabs.querySelectorAll(".day-tab")) {
    button.classList.toggle("active", Number(button.dataset.day) === activeDay);
  }

  const items = entriesForDay(activeDay);

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "这一天还没有安排，适合先放一个锚点：酒店、第一顿饭，或者最想去的地方。";
    timeline.appendChild(empty);
    return;
  }

  for (const entry of items) {
    const fragment = timelineTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".timeline-card");
    const time = fragment.querySelector(".timeline-time");
    const title = fragment.querySelector(".timeline-title");
    const meta = fragment.querySelector(".timeline-meta");
    const notes = fragment.querySelector(".timeline-notes");
    const deleteButton = fragment.querySelector(".delete-button");

    card.dataset.id = entry.id;
    time.textContent = entry.time || "待定时间";
    title.textContent = entry.title;
    meta.textContent = entryMeta(entry);
    notes.textContent = entry.notes || "";

    deleteButton.addEventListener("click", () => {
      state.entries = state.entries.filter((item) => item.id !== entry.id);
      render();
    });

    timeline.appendChild(fragment);
  }
}

function render() {
  fillTripForm();
  syncDayOptions();
  renderSummary();
  renderTimeline();
}

tripForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const startDate = tripStartInput.value;
  const endDate = tripEndInput.value;

  state.trip = {
    name: tripNameInput.value.trim(),
    destination: tripDestinationInput.value.trim(),
    pace: tripPaceInput.value,
    startDate,
    endDate,
    budget: Number(tripBudgetInput.value) || 0,
    currency: tripCurrencyInput.value.trim().toUpperCase() || "CNY",
    notes: tripNotesInput.value.trim()
  };

  normalizeEntriesToTrip();
  activeDay = 1;
  render();
});

entryForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const title = entryTitleInput.value.trim();

  if (!title) {
    entryTitleInput.focus();
    return;
  }

  const selectedDay = Number(entryDayInput.value) || 1;

  state.entries.push({
    id: createId(),
    day: selectedDay,
    time: entryTimeInput.value,
    title,
    place: entryPlaceInput.value.trim(),
    type: entryTypeInput.value,
    cost: Number(entryCostInput.value) || 0,
    status: entryStatusInput.value,
    notes: entryNotesInput.value.trim()
  });

  activeDay = selectedDay;
  entryForm.reset();
  entryTypeInput.value = "sightseeing";
  entryStatusInput.value = "idea";
  entryDayInput.value = String(activeDay);
  render();
  entryTitleInput.focus();
});

entryDayInput.addEventListener("change", () => {
  activeDay = Number(entryDayInput.value) || 1;
  renderTimeline();
});

resetTripButton.addEventListener("click", () => {
  state = structuredClone(emptyState);
  activeDay = 1;
  render();
});

clearDayButton.addEventListener("click", () => {
  state.entries = state.entries.filter((entry) => entry.day !== activeDay);
  render();
});

exportTripButton.addEventListener("click", () => {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const tripName = (state.trip.name || "voyage-atelier-trip").trim().replace(/[^\w\u4e00-\u9fa5-]+/g, "-");

  link.href = url;
  link.download = `${tripName || "voyage-atelier-trip"}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

importTripButton.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", async () => {
  const [file] = importFileInput.files || [];

  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    state = sanitizeImportedState(parsed);
    normalizeEntriesToTrip();
    activeDay = 1;
    render();
  } catch (error) {
    window.alert("导入失败，请确认文件是有效的 JSON 行程文件。");
  } finally {
    importFileInput.value = "";
  }
});

normalizeEntriesToTrip();
render();
