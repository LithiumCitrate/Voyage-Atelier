import { createApp, nextTick } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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

const routePalette = ["#1f7f77", "#d1683f", "#6b6bc5", "#2e7d4f", "#9d5a9e", "#9d7f2f"];
const defaultMapCenter = [34.5, 104];
const defaultMapZoom = 4;
const TIANDITU_KEY = import.meta.env.VITE_TIANDITU_KEY || "";
const TIANDITU_API_BASE = "http://api.tianditu.gov.cn";

createApp({
  data() {
    return {
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
      map: null,
      selectedPointMarker: null,
      routeLayerGroup: null,
      markerLayerGroup: null,
      tiandituLayers: [],
      routeRequestToken: 0,
      routeCache: new Map(),
      adminLabelCache: new Map()
    };
  },

  computed: {
    dayOptions() {
      return Array.from({ length: this.tripDaysCount() }, (_, index) => index + 1);
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
    },

    routeScopeLabel() {
      return this.routeScope === "all" ? "只看最近路线" : "查看全部路线";
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

    activeDay(day) {
      this.entryForm.day = day;
    }
  },

  mounted() {
    this.normalizeEntriesToTrip();
    this.ensureMap();
    void this.renderMapData();
  },

  methods: {
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

      if (!start || !end || end < start) {
        return 1;
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

    distanceToMapCenter(point) {
      if (!this.map) {
        return Number.MAX_SAFE_INTEGER;
      }

      return this.map.distance(this.map.getCenter(), L.latLng(point.lat, point.lng));
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
        this.ensureMap();
        this.map.setView([entry.location.lat, entry.location.lng], 14);

        if (!this.selectedPointMarker) {
          this.selectedPointMarker = this.createSelectedPointLayer(entry.location.lat, entry.location.lng).addTo(this.map);
        } else {
          this.selectedPointMarker.setLatLng([entry.location.lat, entry.location.lng]).addTo(this.map);
        }
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

    createTianDiTuLayer(layerType, key) {
      return L.tileLayer(
        `https://t{s}.tianditu.gov.cn/${layerType}_w/wmts?service=wmts&request=GetTile&version=1.0.0&LAYER=${layerType}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(key)}`,
        {
          subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
          maxZoom: 18,
          attribution: '&copy; <a href="https://www.tianditu.gov.cn/">天地图</a>'
        }
      );
    },

    refreshMapSource() {
      this.ensureMap();

      for (const layer of this.tiandituLayers) {
        this.map.removeLayer(layer);
      }

      const key = this.currentTianDiTuKey();
      this.tiandituLayers = [
        this.createTianDiTuLayer("vec", key),
        this.createTianDiTuLayer("cva", key)
      ];

      for (const layer of this.tiandituLayers) {
        layer.addTo(this.map);
      }
    },

    createSelectedPointLayer(lat, lng) {
      return L.circleMarker([lat, lng], {
        radius: 9,
        weight: 3,
        color: "#13585a",
        fillColor: "#ffffff",
        fillOpacity: 0.96
      });
    },

    ensureMap() {
      if (this.map) {
        return;
      }

      this.map = L.map("map", { zoomControl: true }).setView(defaultMapCenter, defaultMapZoom);
      this.routeLayerGroup = L.layerGroup().addTo(this.map);
      this.markerLayerGroup = L.layerGroup().addTo(this.map);
      this.refreshMapSource();
      this.map.on("moveend", () => {
        if (this.routeScope === "nearest") {
          void this.renderMapData();
        }
      });

      this.map.on("click", (event) => {
        this.pendingMapPoint = {
          lat: event.latlng.lat,
          lng: event.latlng.lng
        };

        if (!this.selectedPointMarker) {
          this.selectedPointMarker = this.createSelectedPointLayer(this.pendingMapPoint.lat, this.pendingMapPoint.lng).addTo(this.map);
        } else {
          this.selectedPointMarker.setLatLng([this.pendingMapPoint.lat, this.pendingMapPoint.lng]).addTo(this.map);
        }

        if (!this.entryForm.place.trim() || this.startsWithMapPlaceholder(this.entryForm.place.trim())) {
          this.entryForm.place = `地图选点 ${this.selectedPointLabel(this.pendingMapPoint)}`;
        }

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

    clearPendingMapPoint() {
      this.pendingMapPoint = null;

      if (this.selectedPointMarker) {
        this.selectedPointMarker.remove();
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
      const bounds = this.map ? this.map.getBounds() : null;
      const mapBound = bounds
        ? `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`
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
      this.ensureMap();
      this.map.setView([item.location.lat, item.location.lng], 15);

      if (!this.selectedPointMarker) {
        this.selectedPointMarker = this.createSelectedPointLayer(item.location.lat, item.location.lng).addTo(this.map);
      } else {
        this.selectedPointMarker.setLatLng([item.location.lat, item.location.lng]).addTo(this.map);
      }
    },

    routeColorForDay(day) {
      return routePalette[(day - 1) % routePalette.length];
    },

    allLocatedEntries() {
      return this.entries.filter((entry) => entry.location);
    },

    fitMapToEntries(entries) {
      this.ensureMap();
      const validEntries = entries.filter((entry) => entry.location);

      if (validEntries.length === 0) {
        this.map.setView(defaultMapCenter, defaultMapZoom);
        return;
      }

      if (validEntries.length === 1) {
        this.map.setView([validEntries[0].location.lat, validEntries[0].location.lng], 13);
        return;
      }

      const bounds = L.latLngBounds(validEntries.map((entry) => [entry.location.lat, entry.location.lng]));
      this.map.fitBounds(bounds.pad(0.18));
    },

    focusAllRoutes() {
      this.fitMapToEntries(this.allLocatedEntries());
    },

    async toggleRouteScope() {
      this.routeScope = this.routeScope === "all" ? "nearest" : "all";

      if (this.routeScope === "all") {
        this.fitMapToEntries(this.allLocatedEntries());
      }

      await this.renderMapData();
    },

    focusEntry(entry) {
      if (!entry.location) {
        return;
      }

      this.ensureMap();
      this.map.setView([entry.location.lat, entry.location.lng], 14);
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

      if (points.length < 2) {
        return [
          [start.lat, start.lng],
          [end.lat, end.lng]
        ];
      }

      return points;
    },

    async fetchRoutePath(start, end) {
      const cacheKey = this.routeCacheKey(start, end);

      if (this.routeCache.has(cacheKey)) {
        return this.routeCache.get(cacheKey);
      }

      const key = this.currentTianDiTuKey();
      const postStr = encodeURIComponent(JSON.stringify({
        orig: `${start.lng},${start.lat}`,
        dest: `${end.lng},${end.lat}`,
        style: "0"
      }));
      const url = `https://api.tianditu.gov.cn/drive?postStr=${postStr}&type=search&tk=${encodeURIComponent(key)}`;
      const routeUrl = `${TIANDITU_API_BASE}/drive?postStr=${postStr}&type=search&tk=${encodeURIComponent(key)}`;

      try {
        const response = await fetch(routeUrl);
        const rawText = await response.text();
        const points = this.parseRouteCoordinates(rawText, start, end);
        this.routeCache.set(cacheKey, points);
        return points;
      } catch (error) {
        const fallback = [
          [start.lat, start.lng],
          [end.lat, end.lng]
        ];
        this.routeCache.set(cacheKey, fallback);
        return fallback;
      }
    },

    async renderMapData() {
      this.ensureMap();
      this.routeLayerGroup.clearLayers();
      this.markerLayerGroup.clearLayers();
      const requestToken = ++this.routeRequestToken;
      const locatedEntries = this.entries.filter((entry) => entry.location);
      const allDays = [...new Set(locatedEntries.map((entry) => entry.day))];
      let visibleDays = allDays;

      if (this.routeScope === "nearest" && locatedEntries.length > 0) {
        const bounds = this.map.getBounds();
        const preferred = locatedEntries
          .map((entry) => ({
            entry,
            inView: bounds.contains([entry.location.lat, entry.location.lng]),
            distance: this.distanceToMapCenter(entry.location)
          }))
          .sort((a, b) => {
            if (a.inView !== b.inView) {
              return a.inView ? -1 : 1;
            }

            return a.distance - b.distance;
          })[0];

        visibleDays = preferred ? [preferred.entry.day] : allDays;
      }

      for (const day of visibleDays) {
        const sortedEntries = this.entriesForDay(day).filter((entry) => entry.location);
        const color = this.routeColorForDay(day);

        for (const entry of sortedEntries) {
          const marker = L.circleMarker([entry.location.lat, entry.location.lng], {
            radius: 8,
            weight: 2,
            color,
            fillColor: "#ffffff",
            fillOpacity: 0.92
          });

          marker.bindPopup(`
            <strong>Day ${entry.day} · ${entry.title}</strong><br>
            ${entry.place || "未填写地点"}<br>
            ${entry.time || "时间待定"}
          `);
          marker.addTo(this.markerLayerGroup);
        }

        if (sortedEntries.length >= 2) {
          for (let index = 0; index < sortedEntries.length - 1; index += 1) {
            const currentEntry = sortedEntries[index];
            const nextEntry = sortedEntries[index + 1];
            const routePoints = await this.fetchRoutePath(currentEntry.location, nextEntry.location);

            if (requestToken !== this.routeRequestToken) {
              return;
            }

            const line = L.polyline(routePoints, {
              color,
              weight: 4,
              opacity: 0.82
            });

            line.bindPopup(`Day ${day} 路线`);
            line.addTo(this.routeLayerGroup);
          }
        }
      }

      if (this.pendingMapPoint) {
        if (!this.selectedPointMarker) {
          this.selectedPointMarker = this.createSelectedPointLayer(this.pendingMapPoint.lat, this.pendingMapPoint.lng).addTo(this.map);
        } else {
          this.selectedPointMarker.setLatLng([this.pendingMapPoint.lat, this.pendingMapPoint.lng]).addTo(this.map);
        }
      } else if (this.selectedPointMarker) {
        this.selectedPointMarker.remove();
        this.selectedPointMarker = null;
      }

      window.setTimeout(() => {
        this.map.invalidateSize();
      }, 0);
    }
  }
}).mount("#app");
