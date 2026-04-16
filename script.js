import { createApp, nextTick } from "vue";

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

const defaultEntryForm = () => ({
  day: 1,
  time: "",
  title: "",
  place: "",
  type: "sightseeing",
  cost: null,
  status: "idea",
  notes: ""
});

const routePalette = ["#8fb6b0", "#cfa58d", "#a8add6", "#9dbb9d", "#c4abc8", "#c4b38a"];
const defaultMapCenter = [34.5, 104];
const defaultMapZoom = 4;
const TIANDITU_KEY = import.meta.env.VITE_TIANDITU_KEY || "";
const TIANDITU_API_BASE = "https://api.tianditu.gov.cn";
const PLANNER_SESSION_KEY = "voyage-atelier-planner-entered";

let tianDiTuScriptPromise = null;

function loadTianDiTuScript(key) {
  if (window.T) {
    return Promise.resolve(window.T);
  }

  if (!key) {
    return Promise.reject(new Error("missing_tianditu_key"));
  }

  if (tianDiTuScriptPromise) {
    return tianDiTuScriptPromise;
  }

  tianDiTuScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://api.tianditu.gov.cn/api?v=4.0&tk=${encodeURIComponent(key)}`;
    script.async = true;
    script.onload = () => {
      if (window.T) {
        resolve(window.T);
      } else {
        reject(new Error("tianditu_runtime_unavailable"));
      }
    };
    script.onerror = () => reject(new Error("tianditu_script_load_failed"));
    document.head.appendChild(script);
  });

  return tianDiTuScriptPromise;
}

createApp({
  data() {
    return {
      showWelcomeScreen: !this.hasPlannerSession(),
      welcomeTouchStartY: null,
      trip: structuredClone(emptyState.trip),
      entries: [],
      entryForm: defaultEntryForm(),
      editingEntryId: null,
      activeDay: 1,
      pendingMapPoint: null,
      mapSearchQuery: "",
      searchResults: [],
      searchTried: false,
      routeScope: "nearest",
      draggedEntryId: null,
      dragOverEntryId: null,
      mapApi: null,
      map: null,
      selectedPointMarker: null,
      mapMarkers: [],
      routePolylines: [],
      routeRequestToken: 0,
      routeCache: new Map(),
      adminLabelCache: new Map(),
      mapError: ""
    };
  },

  computed: {
    dayOptions() {
      return Array.from({ length: this.tripDaysCount() }, (_, index) => index + 1);
    },

    scheduleDays() {
      return [...new Set(this.entries.map((entry) => entry.day))]
        .filter((day) => Number.isFinite(day))
        .sort((a, b) => a - b);
    },

    heroSummaryText() {
      if (!this.trip.destination) {
        return "填写目的地和日期后，就可以按天安排路线，并在地图上看到行程连线。";
      }

      return `${this.trip.destination} · ${this.paceLabel(this.trip.pace)}节奏 · ${this.tripDaysCount()} 天`;
    },

    budgetPercent() {
      const budget = Number(this.trip.budget) || 0;
      const spent = this.usedBudget();
      return budget <= 0 ? 0 : Math.min(999, Math.round((spent / budget) * 100));
    },

    confirmedCount() {
      return this.entries.filter((entry) => entry.status === "confirmed" || entry.status === "booked").length;
    },

    entriesForActiveDay() {
      return this.entriesForDay(this.activeDay);
    },

    isEditingEntry() {
      return Boolean(this.editingEntryId);
    },

    entrySubmitLabel() {
      return this.isEditingEntry ? "保存修改" : "加入行程";
    },

    mapSelectionText() {
      if (!this.pendingMapPoint) {
        return "还没有选点。点击地图后，新建行程会自动绑定这个位置。";
      }

      return `已选择地图位置 ${this.selectedPointLabel(this.pendingMapPoint)}。提交行程时会一起写入。`;
    }
  },

  watch: {
    dayOptions(newOptions) {
      const maxDay = newOptions[newOptions.length - 1] || 1;

      if (this.activeDay > maxDay) {
        this.activeDay = maxDay;
      }

      if (this.entryForm.day > maxDay) {
        this.entryForm.day = maxDay;
      }
    },

    scheduleDays(newDays) {
      if (newDays.length === 0) {
        this.activeDay = 1;
        return;
      }

      if (!newDays.includes(this.activeDay)) {
        this.activeDay = newDays[0];
      }
    },

    activeDay(day) {
      this.entryForm.day = day;
    }
  },

  mounted() {
    window.scrollTo({ top: 0, behavior: "auto" });
    this.syncWelcomeMode();
    window.addEventListener("beforeunload", this.handleBeforeUnload);
    nextTick(() => {
      if (this.showWelcomeScreen) {
        document.querySelector(".welcome-screen")?.focus();
      } else if (!this.map && !this.mapError) {
        void this.initializeMapRuntime();
      }
    });
    this.normalizeEntriesToTrip();
  },

  beforeUnmount() {
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
  },

  methods: {
    hasPlannerSession() {
      try {
        return window.sessionStorage.getItem(PLANNER_SESSION_KEY) === "1";
      } catch (error) {
        return false;
      }
    },

    setPlannerSession(active) {
      try {
        if (active) {
          window.sessionStorage.setItem(PLANNER_SESSION_KEY, "1");
        } else {
          window.sessionStorage.removeItem(PLANNER_SESSION_KEY);
        }
      } catch (error) {
        // Ignore storage failures and fall back to in-memory state.
      }
    },

    handleBeforeUnload() {
      this.setPlannerSession(false);
    },

    async initializeMapRuntime() {
      try {
        this.mapApi = await loadTianDiTuScript(this.currentTianDiTuKey());
        await this.ensureMap();
        await this.renderMapData();
      } catch (error) {
        this.mapError = "天地图加载失败，请检查密钥或网络连接。";
      }
    },

    syncWelcomeMode() {
      document.body.style.overflow = this.showWelcomeScreen ? "hidden" : "";
    },

    async enterPlanner() {
      if (!this.showWelcomeScreen) {
        return;
      }

      this.showWelcomeScreen = false;
      this.setPlannerSession(true);
      this.syncWelcomeMode();
      await nextTick();
      window.scrollTo({ top: 0, behavior: "auto" });

      if (!this.map && !this.mapError) {
        await this.initializeMapRuntime();
      }
    },

    handleWelcomeWheel(event) {
      if (event.deltaY > 8) {
        void this.enterPlanner();
      }
    },

    handleWelcomeKeydown(event) {
      if (["ArrowDown", "PageDown", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        void this.enterPlanner();
      }
    },

    handleWelcomeTouchStart(event) {
      this.welcomeTouchStartY = event.changedTouches?.[0]?.clientY ?? null;
    },

    handleWelcomeTouchEnd(event) {
      const endY = event.changedTouches?.[0]?.clientY ?? null;

      if (this.welcomeTouchStartY !== null && endY !== null && this.welcomeTouchStartY - endY > 36) {
        void this.enterPlanner();
      }

      this.welcomeTouchStartY = null;
    },

    createId() {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
      }

      return `entry-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    },

    sanitizeLocation(location) {
      if (!location || typeof location !== "object") {
        return null;
      }

      const lat = Number(location.lat);
      const lng = Number(location.lng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      return { lat, lng };
    },

    sanitizeImportedState(input) {
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
          id: typeof entry.id === "string" && entry.id ? entry.id : this.createId(),
          day: Math.max(1, Number(entry.day) || 1),
          sequence: Math.max(1, Number(entry.sequence) || 1),
          time: typeof entry.time === "string" ? entry.time : "",
          title: typeof entry.title === "string" ? entry.title : "",
          place: typeof entry.place === "string" ? entry.place : "",
          type: ["sightseeing", "food", "stay", "transport", "shopping", "rest"].includes(entry.type) ? entry.type : "sightseeing",
          cost: Number(entry.cost) || 0,
          status: ["idea", "booked", "confirmed"].includes(entry.status) ? entry.status : "idea",
          notes: typeof entry.notes === "string" ? entry.notes : "",
          location: this.sanitizeLocation(entry.location)
        })).filter((entry) => entry.title)
      };
    },

    parseDate(value) {
      if (!value) {
        return null;
      }

      const date = new Date(`${value}T00:00:00`);
      return Number.isNaN(date.getTime()) ? null : date;
    },

    tripDaysCount() {
      const start = this.parseDate(this.trip.startDate);
      const end = this.parseDate(this.trip.endDate);

      if (!start && !end) {
        return 15;
      }

      if (!start || !end || end < start) {
        return 15;
      }

      const msPerDay = 24 * 60 * 60 * 1000;
      return Math.floor((end - start) / msPerDay) + 1;
    },

    normalizeEntriesToTrip() {
      const maxDay = this.tripDaysCount();
      this.entries = this.entries.map((entry) => ({
        ...entry,
        day: Math.min(Math.max(Number(entry.day) || 1, 1), maxDay),
        sequence: Math.max(1, Number(entry.sequence) || 1),
        location: this.sanitizeLocation(entry.location)
      }));
    },

    formatDateRange() {
      const start = this.parseDate(this.trip.startDate);
      const end = this.parseDate(this.trip.endDate);

      if (!start || !end || end < start) {
        return "还没有设置出行日期";
      }

      const formatter = new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric"
      });

      return `${formatter.format(start)} - ${formatter.format(end)}`;
    },

    formatCurrency(amount) {
      const currency = (this.trip.currency || "CNY").trim().toUpperCase() || "CNY";
      return `${currency} ${Number(amount) || 0}`;
    },

    usedBudget() {
      return this.entries.reduce((sum, entry) => sum + (Number(entry.cost) || 0), 0);
    },

    paceLabel(pace) {
      return {
        slow: "慢游",
        balanced: "平衡",
        packed: "高密度"
      }[pace] || "平衡";
    },

    typeLabel(type) {
      return {
        sightseeing: "观光",
        food: "餐饮",
        stay: "住宿",
        transport: "交通",
        shopping: "购物",
        rest: "休息"
      }[type] || "行程";
    },

    statusLabel(status) {
      return {
        idea: "灵感",
        booked: "已预订",
        confirmed: "已确认"
      }[status] || "灵感";
    },

    entriesForDay(day) {
      return [...this.entries]
        .filter((entry) => entry.day === day)
        .sort((a, b) => {
          if ((a.sequence || 0) !== (b.sequence || 0)) {
            return (a.sequence || 0) - (b.sequence || 0);
          }

          if (a.time !== b.time) {
            return a.time.localeCompare(b.time);
          }

          return a.title.localeCompare(b.title, "zh-CN");
        });
    },

    entryMeta(entry) {
      const parts = [];

      if (entry.place) {
        parts.push(entry.place);
      }

      parts.push(this.typeLabel(entry.type));
      parts.push(this.statusLabel(entry.status));

      if (Number(entry.cost) > 0) {
        parts.push(this.formatCurrency(entry.cost));
      }

      if (entry.location) {
        parts.push("地图已定位");
      }

      return parts.join(" | ");
    },

    selectedPointLabel(point) {
      return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
    },

    startsWithMapPlaceholder(value) {
      return value.startsWith("地图选点 ");
    },

    sanitizeAddressLabel(value) {
      return typeof value === "string" ? value.trim() : "";
    },

    pointCacheKey(point) {
      return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
    },

    currentTianDiTuKey() {
      return TIANDITU_KEY;
    },

    routeCacheKey(start, end) {
      return `${start.lat.toFixed(6)},${start.lng.toFixed(6)}->${end.lat.toFixed(6)},${end.lng.toFixed(6)}`;
    },

    routeSequenceCacheKey(points) {
      return points
        .map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
        .join(" -> ");
    },

    svgToDataUrl(svg) {
      return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    },

    createMarkerIcon(color = "#9dbab4") {
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="72" height="88" viewBox="0 0 72 88">
          <defs>
            <filter id="pinShadow" x="-24%" y="-20%" width="148%" height="148%">
              <feDropShadow dx="0" dy="7" stdDeviation="5.5" flood-color="#203132" flood-opacity="0.16"/>
            </filter>
          </defs>
          <g filter="url(#pinShadow)">
            <path d="M36 7C22.19 7 11 18.04 11 31.66c0 19.39 20.13 39.9 23.67 43.31a1.83 1.83 0 0 0 2.66 0C40.87 71.56 61 51.05 61 31.66 61 18.04 49.81 7 36 7Z" fill="${color}"/>
            <circle cx="36" cy="29" r="17" fill="rgba(255,255,255,0.16)"/>
          </g>
        </svg>
      `.trim();

      return new this.mapApi.Icon({
        iconUrl: this.svgToDataUrl(svg),
        iconSize: new this.mapApi.Point(36, 44),
        iconAnchor: new this.mapApi.Point(18, 44)
      });
    },

    createLngLat(point) {
      return this.mapApi ? new this.mapApi.LngLat(point.lng, point.lat) : null;
    },

    distanceToMapCenter(point) {
      if (!this.map || !this.mapApi) {
        return Number.MAX_SAFE_INTEGER;
      }

      const center = this.map.getCenter();
      const target = this.createLngLat(point);
      return target ? center.distanceTo(target) : Number.MAX_SAFE_INTEGER;
    },

    buildAdministrativeLabel(addressComponent = {}) {
      const parts = [
        addressComponent.province,
        addressComponent.city,
        addressComponent.county
      ].filter((part, index, array) => part && array.indexOf(part) === index);

      return parts.join(" · ");
    },

    normalizeSearchItems(raw) {
      if (!raw) {
        return [];
      }

      if (Array.isArray(raw)) {
        return raw;
      }

      if (Array.isArray(raw.pois)) {
        return raw.pois;
      }

      if (Array.isArray(raw.poi)) {
        return raw.poi;
      }

      if (Array.isArray(raw.results)) {
        return raw.results;
      }

      if (Array.isArray(raw.data)) {
        return raw.data;
      }

      if (Array.isArray(raw.area)) {
        return raw.area;
      }

      return [];
    },

    extractSearchLocation(item) {
      const candidates = [
        item.lonlat,
        item.lonLat,
        item.location,
        item.latlon,
        item.lon_lats
      ];

      for (const value of candidates) {
        if (typeof value === "string" && value.includes(",")) {
          const [lngText, latText] = value.split(",");
          const lng = Number(lngText);
          const lat = Number(latText);

          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng };
          }
        }

        if (value && typeof value === "object") {
          const lng = Number(value.lon ?? value.lng ?? value.x);
          const lat = Number(value.lat ?? value.y);

          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng };
          }
        }
      }

      const lng = Number(item.lon ?? item.lng ?? item.x);
      const lat = Number(item.lat ?? item.y);

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }

      return null;
    },

    extractSearchTitle(item, fallbackKeyword) {
      return this.sanitizeAddressLabel(
        item.name ||
        item.title ||
        item.address ||
        item.poiName ||
        item.standard_name ||
        fallbackKeyword
      ) || fallbackKeyword;
    },

    async fetchAdministrativeLabel(point) {
      const cacheKey = this.pointCacheKey(point);

      if (this.adminLabelCache.has(cacheKey)) {
        return this.adminLabelCache.get(cacheKey);
      }

      const key = this.currentTianDiTuKey();
      const postStr = encodeURIComponent(JSON.stringify({
        lon: point.lng,
        lat: point.lat,
        ver: 1
      }));
      const url = `${TIANDITU_API_BASE}/geocoder?postStr=${postStr}&type=geocode&tk=${encodeURIComponent(key)}`;

      try {
        const response = await fetch(url);
        const data = await response.json();
        const component = data.result?.addressComponent || {};
        const label = this.buildAdministrativeLabel(component) || "行政区划待确认";
        this.adminLabelCache.set(cacheKey, label);
        return label;
      } catch (error) {
        const fallback = "行政区划待确认";
        this.adminLabelCache.set(cacheKey, fallback);
        return fallback;
      }
    },

    nextSequenceForDay(day) {
      const dayEntries = this.entries.filter((entry) => entry.day === day);

      if (dayEntries.length === 0) {
        return 1;
      }

      return Math.max(...dayEntries.map((entry) => Number(entry.sequence) || 1)) + 1;
    },

    reorderEntriesForActiveDay(sourceId, targetId) {
      if (!sourceId || !targetId || sourceId === targetId) {
        return;
      }

      const dayEntries = this.entriesForDay(this.activeDay);
      const sourceIndex = dayEntries.findIndex((entry) => entry.id === sourceId);
      const targetIndex = dayEntries.findIndex((entry) => entry.id === targetId);

      if (sourceIndex === -1 || targetIndex === -1) {
        return;
      }

      const reordered = [...dayEntries];
      const [moved] = reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, moved);

      this.entries = this.entries.map((entry) => {
        if (entry.day !== this.activeDay) {
          return entry;
        }

        const index = reordered.findIndex((item) => item.id === entry.id);

        return {
          ...entry,
          sequence: index + 1
        };
      });
    },

    resetEntryForm() {
      this.entryForm = {
        ...defaultEntryForm(),
        day: this.activeDay
      };
      this.editingEntryId = null;
    },

    async saveTrip() {
      this.trip.currency = (this.trip.currency || "CNY").trim().toUpperCase() || "CNY";
      this.trip.budget = Number(this.trip.budget) || 0;
      this.normalizeEntriesToTrip();
      this.activeDay = Math.min(this.activeDay, this.tripDaysCount());
      this.entryForm.day = Math.min(this.entryForm.day || 1, this.tripDaysCount());
      await nextTick();
      await this.renderMapData();
    },

    async addEntry() {
      const title = this.entryForm.title.trim();

      if (!title) {
        this.$refs.entryTitleInput.focus();
        return;
      }

      const selectedDay = Number(this.entryForm.day) || 1;
      const location = this.pendingMapPoint
        ? { lat: this.pendingMapPoint.lat, lng: this.pendingMapPoint.lng }
        : null;

      if (this.editingEntryId) {
        this.entries = this.entries.map((entry) => {
          if (entry.id !== this.editingEntryId) {
            return entry;
          }

          const targetDay = selectedDay;
          const previousDay = entry.day;

          return {
            ...entry,
            day: targetDay,
            sequence: targetDay === previousDay ? entry.sequence : this.nextSequenceForDay(targetDay),
            time: this.entryForm.time,
            title,
            place: this.entryForm.place.trim(),
            type: this.entryForm.type,
            cost: Number(this.entryForm.cost) || 0,
            status: this.entryForm.status,
            notes: this.entryForm.notes.trim(),
            location
          };
        });
      } else {
        this.entries.push({
          id: this.createId(),
          day: selectedDay,
          sequence: this.nextSequenceForDay(selectedDay),
          time: this.entryForm.time,
          title,
          place: this.entryForm.place.trim(),
          type: this.entryForm.type,
          cost: Number(this.entryForm.cost) || 0,
          status: this.entryForm.status,
          notes: this.entryForm.notes.trim(),
          location
        });
      }

      this.activeDay = selectedDay;
      this.clearPendingMapPoint();
      this.resetEntryForm();
      await nextTick();
      await this.renderMapData();
      this.$refs.entryTitleInput.focus();
    },

    async deleteEntry(id) {
      if (this.editingEntryId === id) {
        this.cancelEntryEdit();
      }

      this.entries = this.entries.filter((entry) => entry.id !== id);
      await nextTick();
      await this.renderMapData();
    },

    async clearCurrentDay() {
      this.entries = this.entries.filter((entry) => entry.day !== this.activeDay);
      await nextTick();
      await this.renderMapData();
    },

    async resetTrip() {
      this.trip = structuredClone(emptyState.trip);
      this.entries = [];
      this.activeDay = 1;
      this.searchResults = [];
      this.searchTried = false;
      this.mapSearchQuery = "";
      this.clearPendingMapPoint();
      this.resetEntryForm();
      await nextTick();
      await this.renderMapData();
      this.fitMapToEntries([]);
    },

    startEditEntry(entry) {
      this.editingEntryId = entry.id;
      this.activeDay = entry.day;
      this.entryForm = {
        day: entry.day,
        time: entry.time || "",
        title: entry.title || "",
        place: entry.place || "",
        type: entry.type || "sightseeing",
        cost: Number(entry.cost) || null,
        status: entry.status || "idea",
        notes: entry.notes || ""
      };

      if (entry.location) {
        this.pendingMapPoint = {
          lat: entry.location.lat,
          lng: entry.location.lng
        };
        void this.ensureMap().then(() => {
          this.map.centerAndZoom(this.createLngLat(entry.location), 14);
          void this.renderMapData();
        });
      } else {
        this.clearPendingMapPoint();
      }

      nextTick(() => {
        this.$refs.entryTitleInput?.focus();
      });
    },

    cancelEntryEdit() {
      this.clearPendingMapPoint();
      this.resetEntryForm();
    },

    exportTrip() {
      const payload = JSON.stringify({
        trip: this.trip,
        entries: this.entries
      }, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const tripName = (this.trip.name || "voyage-atelier-trip").trim().replace(/[^\w\u4e00-\u9fa5-]+/g, "-");

      link.href = url;
      link.download = `${tripName || "voyage-atelier-trip"}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },

    async handleImport(event) {
      const [file] = event.target.files || [];

      if (!file) {
        return;
      }

      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const imported = this.sanitizeImportedState(parsed);
        this.trip = imported.trip;
        this.entries = imported.entries;
        this.normalizeEntriesToTrip();
        this.activeDay = 1;
        this.clearPendingMapPoint();
        this.resetEntryForm();
        await nextTick();
        await this.renderMapData();
        this.fitMapToEntries(this.allLocatedEntries());
      } catch (error) {
        window.alert("导入失败，请确认文件是有效的 JSON 行程文件。");
      } finally {
        event.target.value = "";
      }
    },

    handleDragStart(entryId, event) {
      this.draggedEntryId = entryId;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", entryId);
    },

    handleDragOver(entryId) {
      if (this.draggedEntryId && this.draggedEntryId !== entryId) {
        this.dragOverEntryId = entryId;
      }
    },

    handleDragLeave(entryId) {
      if (this.dragOverEntryId === entryId) {
        this.dragOverEntryId = null;
      }
    },

    async handleDrop(targetId) {
      this.reorderEntriesForActiveDay(this.draggedEntryId, targetId);
      this.draggedEntryId = null;
      this.dragOverEntryId = null;
      await nextTick();
      await this.renderMapData();
    },

    handleDragEnd() {
      this.draggedEntryId = null;
      this.dragOverEntryId = null;
    },

    selectedPointColor() {
      const selectedDay = Number(this.entryForm.day) || Number(this.activeDay) || 1;
      return this.routeColorForDay(selectedDay);
    },

    createSelectedPointLayer(lat, lng, color = null) {
      return new this.mapApi.Marker(this.createLngLat({ lat, lng }), {
        icon: this.createMarkerIcon(color || this.selectedPointColor())
      });
    },

    createEntryMarker(entry, color, markerPoint = null) {
      const marker = new this.mapApi.Marker(this.createLngLat(markerPoint || entry.location), {
        icon: this.createMarkerIcon(color)
      });
      const infoWindow = new this.mapApi.InfoWindow(`
        <strong>Day ${entry.day} · ${entry.title}</strong><br>
        ${entry.place || "未填写地点"}<br>
        ${entry.time || "时间待定"} · ${this.statusLabel(entry.status)}
      `);
      marker.addEventListener("click", () => {
        marker.openInfoWindow(infoWindow);
      });
      return marker;
    },

    clearMapOverlays() {
      if (!this.map) {
        return;
      }

      for (const marker of this.mapMarkers) {
        this.map.removeOverLay(marker);
      }

      for (const polyline of this.routePolylines) {
        this.map.removeOverLay(polyline);
      }

      this.mapMarkers = [];
      this.routePolylines = [];
    },

    async ensureMap() {
      if (this.map) {
        return;
      }

      if (!this.mapApi) {
        this.mapApi = await loadTianDiTuScript(this.currentTianDiTuKey());
      }

      this.map = new this.mapApi.Map("map");
      this.map.centerAndZoom(new this.mapApi.LngLat(defaultMapCenter[1], defaultMapCenter[0]), defaultMapZoom);
      this.map.enableScrollWheelZoom();

      this.map.addEventListener("moveend", () => {
        if (this.routeScope === "nearest") {
          void this.renderMapData();
        }
      });

      this.map.addEventListener("click", (event) => {
        this.pendingMapPoint = {
          lat: event.lnglat.getLat(),
          lng: event.lnglat.getLng()
        };

        if (!this.entryForm.place.trim() || this.startsWithMapPlaceholder(this.entryForm.place.trim())) {
          this.entryForm.place = `地图选点 ${this.selectedPointLabel(this.pendingMapPoint)}`;
        }

        void this.renderMapData();

        void this.reverseGeocodePoint(this.pendingMapPoint).then((address) => {
          if (!address || !this.pendingMapPoint) {
            return;
          }

          const currentValue = this.entryForm.place.trim();

          if (!currentValue || this.startsWithMapPlaceholder(currentValue)) {
            this.entryForm.place = address;
          }
        });
      });
    },

    async ensureMapReady() {
      if (this.map) {
        return true;
      }

      if (!this.mapError) {
        await this.initializeMapRuntime();
      }

      return Boolean(this.map);
    },

    clearPendingMapPoint() {
      this.pendingMapPoint = null;

      if (this.selectedPointMarker && this.map) {
        this.map.removeOverLay(this.selectedPointMarker);
        this.selectedPointMarker = null;
      }
    },

    async reverseGeocodePoint(point) {
      const key = this.currentTianDiTuKey();
      const postStr = encodeURIComponent(JSON.stringify({
        lon: point.lng,
        lat: point.lat,
        ver: 1
      }));
      const url = `${TIANDITU_API_BASE}/geocoder?postStr=${postStr}&type=geocode&tk=${encodeURIComponent(key)}`;

      try {
        const response = await fetch(url);
        const data = await response.json();
        const result = data.result || {};
        const address = this.sanitizeAddressLabel(
          result.formatted_address ||
          result.addressComponent?.poi ||
          result.addressComponent?.road ||
          result.addressComponent?.address
        );

        return address || null;
      } catch (error) {
        return null;
      }
    },

    async searchPlaces() {
      const trimmedKeyword = this.mapSearchQuery.trim();
      this.searchTried = false;
      this.searchResults = [];

      if (!trimmedKeyword) {
        return;
      }

      const key = this.currentTianDiTuKey();
      const ready = await this.ensureMapReady();
      if (!ready) {
        return;
      }

      const bounds = this.map ? this.map.getBounds() : null;
      const mapBound = bounds
        ? `${bounds.getSouthWest().getLng()},${bounds.getSouthWest().getLat()},${bounds.getNorthEast().getLng()},${bounds.getNorthEast().getLat()}`
        : `${defaultMapCenter[1] - 10},${defaultMapCenter[0] - 8},${defaultMapCenter[1] + 10},${defaultMapCenter[0] + 8}`;
      const requests = [
        {
          keyWord: trimmedKeyword,
          mapBound,
          level: this.map ? this.map.getZoom() : 12,
          queryType: 2,
          start: 0,
          count: 6
        },
        {
          keyWord: trimmedKeyword,
          mapBound: "-180,-90,180,90",
          level: 12,
          queryType: 1,
          start: 0,
          count: 8
        }
      ];

      try {
        const responses = await Promise.all(requests.map(async (payload) => {
          const postStr = encodeURIComponent(JSON.stringify(payload));
          const url = `${TIANDITU_API_BASE}/v2/search?postStr=${postStr}&type=query&tk=${encodeURIComponent(key)}`;
          const response = await fetch(url);
          return response.json();
        }));

        const merged = new Map();

        for (const data of responses) {
          const items = this.normalizeSearchItems(data?.pois || data?.result || data);

          for (const item of items) {
            const location = this.extractSearchLocation(item);

            if (!location) {
              continue;
            }

            const title = this.extractSearchTitle(item, trimmedKeyword);
            const mapKey = `${title}-${location.lat.toFixed(6)}-${location.lng.toFixed(6)}`;

            if (!merged.has(mapKey)) {
              merged.set(mapKey, {
                id: mapKey,
                title,
                location,
                rawItem: item
              });
            }
          }
        }

        const sorted = [...merged.values()]
          .map((item) => {
            const inView = this.map ? this.map.getBounds().contains([item.location.lat, item.location.lng]) : false;
            const distance = this.distanceToMapCenter(item.location);

            return {
              ...item,
              inView,
              distance
            };
          })
          .sort((a, b) => {
            if (a.inView !== b.inView) {
              return a.inView ? -1 : 1;
            }

            return a.distance - b.distance;
          })
          .slice(0, 6);

        const withAdminLabels = await Promise.all(sorted.map(async (item) => ({
          id: item.id,
          title: item.title,
          location: item.location,
          meta: await this.fetchAdministrativeLabel(item.location)
        })));

        this.searchResults = withAdminLabels;
        this.searchTried = true;
      } catch (error) {
        this.searchResults = [];
        this.searchTried = true;
      }
    },

    pickSearchResult(item) {
      this.pendingMapPoint = {
        lat: item.location.lat,
        lng: item.location.lng
      };
      this.entryForm.place = item.title;
      this.searchResults = [];
      this.searchTried = false;
      void this.ensureMapReady().then((ready) => {
        if (!ready) {
          return;
        }

        this.map.centerAndZoom(this.createLngLat(item.location), 15);
        void this.renderMapData();
      });
    },

    routeColorForDay(day) {
      return routePalette[(day - 1) % routePalette.length];
    },

    locationGroupKey(point) {
      return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
    },

    buildMarkerDisplayLocations(entries) {
      const groupedEntries = new Map();

      for (const entry of entries) {
        if (!entry.location) {
          continue;
        }

        const key = this.locationGroupKey(entry.location);

        if (!groupedEntries.has(key)) {
          groupedEntries.set(key, []);
        }

        groupedEntries.get(key).push(entry);
      }

      const displayLocations = new Map();

      for (const group of groupedEntries.values()) {
        const sortedGroup = [...group].sort((a, b) => {
          if ((a.day || 0) !== (b.day || 0)) {
            return (a.day || 0) - (b.day || 0);
          }

          if ((a.sequence || 0) !== (b.sequence || 0)) {
            return (a.sequence || 0) - (b.sequence || 0);
          }

          return String(a.id).localeCompare(String(b.id));
        });

        if (sortedGroup.length === 1) {
          const [entry] = sortedGroup;
          displayLocations.set(entry.id, entry.location);
          continue;
        }

        const radius = 0.0032;

        sortedGroup.forEach((entry, index) => {
          const angle = (Math.PI * 2 * index) / sortedGroup.length - Math.PI / 2;
          const lngOffset = Math.cos(angle) * radius;
          const latOffset = Math.sin(angle) * radius * 0.8;

          displayLocations.set(entry.id, {
            lat: entry.location.lat + latOffset,
            lng: entry.location.lng + lngOffset
          });
        });
      }

      return displayLocations;
    },

    allLocatedEntries() {
      return this.entries.filter((entry) => entry.location);
    },

    async fitMapToEntries(entries) {
      const ready = await this.ensureMapReady();
      if (!ready) {
        return;
      }

      const validEntries = entries.filter((entry) => entry.location);

      if (validEntries.length === 0) {
        this.map.centerAndZoom(new this.mapApi.LngLat(defaultMapCenter[1], defaultMapCenter[0]), defaultMapZoom);
        return;
      }

      if (validEntries.length === 1) {
        this.map.centerAndZoom(this.createLngLat(validEntries[0].location), 13);
        return;
      }

      this.map.setViewport(validEntries.map((entry) => this.createLngLat(entry.location)));
    },

    focusAllRoutes() {
      void this.fitMapToEntries(this.allLocatedEntries());
    },

    async focusEntry(entry) {
      if (!entry.location) {
        return;
      }

      const ready = await this.ensureMapReady();
      if (!ready) {
        return;
      }

      this.map.centerAndZoom(this.createLngLat(entry.location), 14);
    },

    parseRouteCoordinates(rawText, start, end) {
      const coordinateMatches = rawText.match(/-?\d+\.\d+,-?\d+\.\d+/g) || [];
      const points = [];

      for (const match of coordinateMatches) {
        const [lngText, latText] = match.split(",");
        const lat = Number(latText);
        const lng = Number(lngText);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          continue;
        }

        const previous = points[points.length - 1];

        if (previous && Math.abs(previous[0] - lat) < 0.000001 && Math.abs(previous[1] - lng) < 0.000001) {
          continue;
        }

        points.push([lat, lng]);
      }

      if (points.length < 3) {
        return null;
      }

      return points;
    },

    parseXmlRouteCoordinates(rawText) {
      if (typeof rawText !== "string" || !rawText.trim()) {
        return null;
      }

      try {
        const xmlDoc = new DOMParser().parseFromString(rawText, "text/xml");
        const routeLatLon = xmlDoc.getElementsByTagName("routelatlon")[0]?.textContent?.trim();

        if (!routeLatLon) {
          return null;
        }

        const points = routeLatLon
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => {
            const [lngText, latText] = item.split(",");
            const lat = Number(latText);
            const lng = Number(lngText);

            return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
          })
          .filter(Boolean);

        if (points.length >= 2) {
          return points;
        }
      } catch (error) {
        return null;
      }

      return null;
    },

    async fetchRecommendedRoutePath(points) {
      const normalizedPoints = points.filter((point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lng));

      if (normalizedPoints.length < 2) {
        return null;
      }

      const cacheKey = this.routeSequenceCacheKey(normalizedPoints);

      if (this.routeCache.has(cacheKey)) {
        return this.routeCache.get(cacheKey);
      }

      const start = normalizedPoints[0];
      const end = normalizedPoints[normalizedPoints.length - 1];
      const midPoints = normalizedPoints
        .slice(1, -1)
        .map((point) => `${point.lng},${point.lat}`)
        .join(";");
      const key = this.currentTianDiTuKey();
      const routePayload = {
        orig: `${start.lng},${start.lat}`,
        dest: `${end.lng},${end.lat}`,
        style: "0"
      };

      if (midPoints) {
        routePayload.mid = midPoints;
      }

      const postStr = encodeURIComponent(JSON.stringify(routePayload));
      const routeUrl = `${TIANDITU_API_BASE}/drive?postStr=${postStr}&type=search&tk=${encodeURIComponent(key)}`;

      try {
        const response = await fetch(routeUrl);
        const rawText = await response.text();
        const pointsFromXml = this.parseXmlRouteCoordinates(rawText);
        const routePoints = pointsFromXml || this.parseRouteCoordinates(rawText, start, end);
        this.routeCache.set(cacheKey, routePoints);
        return routePoints;
      } catch (error) {
        this.routeCache.set(cacheKey, null);
        return null;
      }
    },

    async renderMapData() {
      const ready = await this.ensureMapReady();
      if (!ready) {
        return;
      }

      this.clearMapOverlays();
      const requestToken = ++this.routeRequestToken;
      const locatedEntries = this.entries.filter((entry) => entry.location);
      const markerDisplayLocations = this.buildMarkerDisplayLocations(locatedEntries);

      for (const day of [...new Set(locatedEntries.map((entry) => entry.day))]) {
        const sortedEntries = this.entriesForDay(day).filter((entry) => entry.location);
        const color = this.routeColorForDay(day);

        for (const entry of sortedEntries) {
          const marker = this.createEntryMarker(entry, color, markerDisplayLocations.get(entry.id) || entry.location);
          this.map.addOverLay(marker);
          this.mapMarkers.push(marker);
        }
      }

      const allDays = [...new Set(locatedEntries.map((entry) => entry.day))];
      let routeDay = null;
      const activeDayEntries = this.entriesForDay(this.activeDay).filter((entry) => entry.location);

      if (activeDayEntries.length > 0) {
        routeDay = this.activeDay;
      } else if (locatedEntries.length > 0) {
        const bounds = this.map.getBounds();
        const preferred = locatedEntries
          .map((entry) => ({
            entry,
            inView: bounds.contains(this.createLngLat(entry.location)),
            distance: this.distanceToMapCenter(entry.location)
          }))
          .sort((a, b) => {
            if (a.inView !== b.inView) {
              return a.inView ? -1 : 1;
            }

            return a.distance - b.distance;
          })[0];

        routeDay = preferred ? preferred.entry.day : allDays[0] || null;
      }

      if (routeDay !== null) {
        const sortedEntries = this.entriesForDay(routeDay).filter((entry) => entry.location);

        if (sortedEntries.length >= 2) {
          const color = this.routeColorForDay(routeDay);
          const routePoints = await this.fetchRecommendedRoutePath(sortedEntries.map((entry) => entry.location));

          if (requestToken !== this.routeRequestToken) {
            return;
          }

          if (routePoints && routePoints.length >= 3) {
            const line = new this.mapApi.Polyline(
              routePoints.map(([lat, lng]) => new this.mapApi.LngLat(lng, lat)),
              {
                color,
                weight: 3,
                opacity: 0.68
              }
            );

            line.addEventListener("click", (event) => {
              this.map.openInfoWindow(new this.mapApi.InfoWindow(`Day ${routeDay} 推荐路线`), event.lnglat);
            });
            this.map.addOverLay(line);
            this.routePolylines.push(line);
          }
        }
      }

      if (this.pendingMapPoint) {
        const pendingPointColor = this.selectedPointColor();

        if (!this.selectedPointMarker) {
          this.selectedPointMarker = this.createSelectedPointLayer(
            this.pendingMapPoint.lat,
            this.pendingMapPoint.lng,
            pendingPointColor
          );
          this.map.addOverLay(this.selectedPointMarker);
        } else {
          this.map.removeOverLay(this.selectedPointMarker);
          this.selectedPointMarker = this.createSelectedPointLayer(
            this.pendingMapPoint.lat,
            this.pendingMapPoint.lng,
            pendingPointColor
          );
          this.map.addOverLay(this.selectedPointMarker);
          this.selectedPointMarker.setLngLat(this.createLngLat(this.pendingMapPoint));
        }
      } else if (this.selectedPointMarker) {
        this.map.removeOverLay(this.selectedPointMarker);
        this.selectedPointMarker = null;
      }
    }
  }
}).mount("#app");
