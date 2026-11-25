import { lineLength, polygonArea } from './geometry.mjs';

const element = (id) => document.getElementById(id);
const hint = element('hint');
const result = element('result');
const copy = element('copy');
const copyStatus = element('copy-status');
const finish = element('finish');
const undo = element('undo');
const clear = element('clear');
const mapElement = element('map');
const mapNotice = element('map-notice');
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const instructions = {
  length: 'Укажите минимум две точки линии и нажмите «Завершить».',
  area: 'Укажите минимум три вершины по контуру и нажмите «Завершить».',
  coordinate: 'Укажите точку на карте, чтобы получить её координаты WGS 84.',
};

if (window.L) {
  initializeMap(window.L);
} else {
  mapNotice.textContent = 'Карта не загрузилась. Проверьте подключение и обновите страницу.';
}

function initializeMap(L) {
  const homeBounds = L.latLngBounds([57.91, 55.98], [58.17, 56.57]);
  const map = L.map(mapElement, { minZoom: 2, maxZoom: 20, zoomControl: false });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com/">Leaflet</a>');
  const goHome = () => map.fitBounds(homeBounds, { padding: [16, 16], animate: false });
  const shared = new URLSearchParams(window.location.hash.slice(1));
  const sharedCenter = readPoint(shared.get('view'));
  const sharedZoom = Number(shared.get('z'));
  if (sharedCenter && Number.isInteger(sharedZoom) && sharedZoom >= map.getMinZoom() && sharedZoom <= map.getMaxZoom()) {
    map.setView(sharedCenter, sharedZoom);
  } else {
    goHome();
  }
  element('home').addEventListener('click', goHome);
  const zoomIn = element('zoom-in');
  const zoomOut = element('zoom-out');
  function updateZoomButtons() {
    zoomIn.disabled = map.getZoom() >= map.getMaxZoom();
    zoomOut.disabled = map.getZoom() <= map.getMinZoom();
  }
  zoomIn.addEventListener('click', () => map.zoomIn());
  zoomOut.addEventListener('click', () => map.zoomOut());
  map.on('zoomend', updateZoomButtons);
  updateZoomButtons();

  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19,
    maxZoom: 20,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
  const imageryUrl = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
  const imageryAttribution = 'Esri, Vantor, Earthstar Geographics, GIS User Community';
  const imagery = L.esri?.tiledMapLayer({ url: imageryUrl, maxZoom: 20 }) ??
    L.tileLayer(`${imageryUrl}/tile/{z}/{y}/{x}`, { maxZoom: 20, attribution: imageryAttribution });
  const basemaps = { osm, imagery };
  let activeBasemap;
  let basemapName;

  for (const layer of Object.values(basemaps)) {
    let tilesLoaded = false;
    layer.on('loading', () => { tilesLoaded = false; });
    layer.on('tileload', () => {
      tilesLoaded = true;
      if (layer === activeBasemap) mapNotice.hidden = true;
    });
    layer.on('load', () => {
      if (layer !== activeBasemap || tilesLoaded) return;
      mapNotice.textContent = 'Подложка недоступна. Смените слой или обновите страницу.';
      mapNotice.hidden = false;
    });
  }

  function showBasemap(name) {
    if (activeBasemap) map.removeLayer(activeBasemap);
    basemapName = name;
    mapElement.dataset.basemap = name;
    activeBasemap = basemaps[name];
    mapNotice.textContent = 'Загрузка подложки…';
    mapNotice.hidden = false;
    activeBasemap.addTo(map).bringToBack();
  }

  const baseInputs = [...document.querySelectorAll('input[name="basemap"]')];
  showBasemap(shared.get('base') === 'imagery' ? 'imagery' : 'osm');
  for (const input of baseInputs) {
    input.checked = input.value === basemapName;
    input.addEventListener('change', () => showBasemap(input.value));
  }

  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  addRiverCredit(L, map);
  const overlay = L.layerGroup();
  const extent = L.rectangle(homeBounds, { color: '#065a55', dashArray: '6 5', weight: 2, fill: false, interactive: false });
  const showResult = element('measurements');
  const showExtent = element('home-extent');
  const syncLayer = (input, layer) => input.checked ? map.addLayer(layer) : map.removeLayer(layer);
  for (const [input, layer] of [[showResult, overlay], [showExtent, extent]]) {
    syncLayer(input, layer);
    input.addEventListener('change', () => syncLayer(input, layer));
  }

  const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const quantity = (value, threshold, smallUnit, largeUnit) => value >= threshold
    ? `${numberFormat.format(value / threshold)} ${largeUnit}`
    : `${numberFormat.format(value)} ${smallUnit}`;
  const requiredPoints = { length: 2, area: 3, coordinate: 1 };
  const color = '#00786c';
  let mode;
  let drawing = false;
  let points = [];
  let pinMode = false;
  let pin;
  let activePanel;
  const drawer = element('drawer');
  const panelButtons = [...document.querySelectorAll('[data-panel]')];
  const panelTitles = { layers: 'Слои карты', measure: 'Измерения', share: 'Поделиться картой' };
  const mark = element('mark');
  const shareUrl = element('share-url');
  const shareStatus = element('share-status');
  const feedback = element('map-feedback');
  let feedbackTimer;

  function flash(message, duration = 4200) {
    window.clearTimeout(feedbackTimer);
    feedback.textContent = message;
    feedback.hidden = !message;
    if (message && duration) feedbackTimer = window.setTimeout(() => flash(''), duration);
  }

  function updateMapCursor() {
    mapElement.classList.toggle('is-measuring', pinMode || (drawing && activePanel === 'measure'));
  }

  function setPinMode(enabled) {
    pinMode = enabled;
    mark.setAttribute('aria-pressed', String(enabled));
    updateMapCursor();
  }

  function setPanel(panel, restoreFocus = false) {
    const previous = activePanel;
    activePanel = panel;
    drawer.hidden = !panel;
    drawer.dataset.active = panel ?? '';
    for (const button of panelButtons) {
      const selected = button.dataset.panel === panel;
      button.setAttribute('aria-expanded', String(selected));
      element(`${button.dataset.panel}-panel`).hidden = !selected;
      if (restoreFocus && previous === button.dataset.panel) button.focus();
    }
    if (panel) {
      element('drawer-heading').textContent = panelTitles[panel];
      setPinMode(false);
      if (panel === 'share') updateShareUrl();
    }
    updateMapCursor();
  }

  for (const button of panelButtons) {
    button.addEventListener('click', () => {
      if (pinMode) flash('');
      setPanel(activePanel === button.dataset.panel ? undefined : button.dataset.panel);
    });
  }
  element('close-panel').addEventListener('click', () => setPanel(undefined, true));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (activePanel) setPanel(undefined, true);
    else if (pinMode) {
      setPinMode(false);
      flash('');
      mark.focus();
    }
  });

  const pointText = (point) => {
    const { lat, lng } = point.wrap();
    return `${lat.toFixed(6)},${lng.toFixed(6)}`;
  };

  function readPoint(text) {
    const match = /^(-?\d{1,3}(?:\.\d{1,8})?),(-?\d{1,3}(?:\.\d{1,8})?)$/.exec(text ?? '');
    if (!match) return null;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    return Math.abs(lat) <= 85.051129 && Math.abs(lng) <= 180 ? [lat, lng] : null;
  }

  function updateShareUrl() {
    const url = new URL(window.location.href);
    url.search = '';
    const params = new URLSearchParams({ view: pointText(map.getCenter()), z: map.getZoom(), base: basemapName });
    if (pin) params.set('pin', pointText(pin.getLatLng()));
    url.hash = params.toString();
    if (shareUrl.value !== url.href) shareStatus.textContent = '';
    shareUrl.value = url.href;
  }

  map.on('moveend', () => {
    if (activePanel === 'share') updateShareUrl();
  });
  element('copy-link').addEventListener('click', async () => {
    updateShareUrl();
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      shareStatus.textContent = 'Ссылка скопирована.';
    } catch {
      shareUrl.select();
      shareStatus.textContent = 'Ссылка выделена. Скопируйте её вручную.';
    }
  });

  function placePin(point) {
    pin?.remove();
    const popup = document.createElement('div');
    popup.className = 'pin-popup';
    const title = document.createElement('strong');
    title.textContent = 'Метка';
    const coordinates = document.createElement('div');
    coordinates.textContent = pointText(L.latLng(point)).replace(',', ', ');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-button';
    remove.textContent = 'Удалить метку';
    remove.addEventListener('click', () => {
      pin.remove();
      pin = undefined;
      if (activePanel === 'share') updateShareUrl();
      flash('Метка удалена.');
    });
    popup.append(title, coordinates, remove);
    pin = L.marker(point, {
      title: 'Метка',
      alt: 'Метка',
      icon: L.divIcon({ className: 'pin-icon', html: '<span class="map-pin"></span>', iconSize: [28, 29], iconAnchor: [14, 25], popupAnchor: [0, -23] }),
    }).addTo(map).bindPopup(popup);
  }

  const sharedPin = readPoint(shared.get('pin'));
  if (sharedPin) placePin(sharedPin);
  mark.addEventListener('click', () => {
    setPanel(undefined);
    setPinMode(!pinMode);
    flash(pinMode ? 'Укажите место на карте для метки.' : '', 0);
  });

  const locate = element('locate');
  const locationLayers = L.layerGroup().addTo(map);
  locate.addEventListener('click', () => {
    locate.disabled = true;
    flash('Определяю местоположение…', 0);
    map.locate({ timeout: 8000, maximumAge: 30000 });
  });
  map.on('locationfound', ({ latlng, accuracy }) => {
    locate.disabled = false;
    locationLayers.clearLayers();
    L.circle(latlng, { radius: accuracy, weight: 1, color: '#1769aa', interactive: false }).addTo(locationLayers);
    L.circleMarker(latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#1769aa', fillOpacity: 1, interactive: false }).addTo(locationLayers);
    map.setView(latlng, Math.min(16, map.getBoundsZoom(latlng.toBounds(Math.max(accuracy * 3, 100)))));
    flash('Ваше местоположение отмечено на карте.');
  });
  map.on('locationerror', ({ code }) => {
    locate.disabled = false;
    flash(code === 1 ? 'Браузер не разрешил доступ к местоположению.' : 'Не удалось определить местоположение.');
  });

  function renderMeasurement() {
    overlay.clearLayers();
    if (points.length > 1 && mode === 'area' && points.length >= 3) {
      L.polygon(points, { color, weight: 3, fillOpacity: .25, interactive: false }).addTo(overlay);
    } else if (points.length > 1) {
      L.polyline(points, { color, weight: 4, interactive: false }).addTo(overlay);
    }
    for (const point of points) {
      L.circleMarker(point, { radius: mode === 'coordinate' ? 7 : 4, weight: 2, color: '#fff', fillColor: color, fillOpacity: 1, interactive: false }).addTo(overlay);
    }

    result.hidden = points.length < (requiredPoints[mode] ?? 1);
    if (result.hidden) {
      result.textContent = '';
    } else if (mode === 'length') {
      result.textContent = quantity(lineLength(points, (a, b) => map.distance(a, b)), 1000, 'м', 'км');
    } else if (mode === 'area') {
      result.textContent = quantity(polygonArea(points, L.CRS.Earth.R), 1000000, 'м²', 'км²');
    } else {
      const { lat, lng } = points[0].wrap();
      result.textContent = `Широта ${lat.toFixed(6)}°\nДолгота ${lng.toFixed(6)}°`;
    }

    const drawingShape = drawing && mode !== 'coordinate';
    finish.hidden = !drawingShape;
    finish.disabled = points.length < requiredPoints[mode];
    undo.hidden = !drawingShape || points.length === 0;
    clear.hidden = points.length === 0;
    copy.hidden = mode !== 'coordinate' || points.length === 0;
    copyStatus.textContent = '';
    hint.textContent = drawing ? instructions[mode]
      : points.length ? 'Измерение завершено.' : 'Выберите инструмент и укажите точки на карте.';
    updateMapCursor();
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(drawing && button.dataset.mode === mode));
    }
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      drawing = true;
      points = [];
      showResult.checked = true;
      syncLayer(showResult, overlay);
      renderMeasurement();
    });
  }

  function placePoint(point) {
    if (pinMode) {
      setPinMode(false);
      placePin(point);
      flash('Метка добавлена. Её можно отправить через «Поделиться».');
      return;
    }
    if (!drawing || activePanel !== 'measure') return;
    if (mode === 'coordinate') points = [point];
    else if (!points.at(-1)?.equals(point)) points.push(point);
    renderMeasurement();
  }

  map.on('click', ({ latlng }) => placePoint(latlng));
  mapElement.addEventListener('keydown', (event) => {
    if (event.target === mapElement && event.key === 'Enter' && (pinMode || (drawing && activePanel === 'measure'))) {
      event.preventDefault();
      placePoint(map.getCenter());
    }
  });
  finish.addEventListener('click', () => {
    if (points.length < requiredPoints[mode]) return;
    drawing = false;
    renderMeasurement();
    clear.focus();
  });
  undo.addEventListener('click', () => {
    points.pop();
    renderMeasurement();
  });
  clear.addEventListener('click', () => {
    points = [];
    renderMeasurement();
  });
  copy.addEventListener('click', async () => {
    const { lat, lng } = points[0].wrap();
    try {
      await navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      copyStatus.textContent = 'Координаты скопированы.';
    } catch {
      copyStatus.textContent = 'Буфер обмена недоступен. Координаты можно выделить и скопировать вручную.';
    }
  });
}

function addRiverCredit(L, map) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 500 150');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Вайбкодил Моисеенко Илья)');
  svg.classList.add('river-credit');
  svg.innerHTML = `
    <defs><path id="kama-credit-path" d="M15 134 Q48 112 87 121 C124 127 149 137 184 133 S244 126 289 119 S362 107 399 86 Q440 62 470 9"/></defs>
    <text text-anchor="middle" dy=".3em"><textPath href="#kama-credit-path" startOffset="61%">Вайбкодил Моисеенко Илья)</textPath></text>`;
  // The viewBox and bounds are matched in Web Mercator at zoom 11.
  const bounds = L.latLngBounds([58.00991667, 55.98976135], [58.06443997, 56.33308411]);
  const label = L.svgOverlay(svg, bounds);
  const text = svg.querySelector('text');

  function updateLabel() {
    const zoom = map.getZoom();
    if (zoom < 9 || zoom > 16) {
      label.remove();
      return;
    }
    const screenSize = Math.min(20, 8 + (zoom - 9) * 3.5);
    text.setAttribute('font-size', screenSize / 2 ** (zoom - 11));
    if (!map.hasLayer(label)) label.addTo(map);
  }

  map.on('zoomend', updateLabel);
  updateLabel();
}
