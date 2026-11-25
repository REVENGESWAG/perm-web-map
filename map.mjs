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
  const map = L.map(mapElement, { minZoom: 2, maxZoom: 20 });
  const goHome = () => map.fitBounds(homeBounds, { padding: [16, 16], animate: false });
  goHome();
  element('home').addEventListener('click', goHome);

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
    activeBasemap = basemaps[name];
    mapNotice.textContent = 'Загрузка подложки…';
    mapNotice.hidden = false;
    activeBasemap.addTo(map).bringToBack();
  }

  const baseInputs = [...document.querySelectorAll('input[name="basemap"]')];
  showBasemap(baseInputs.find((input) => input.checked).value);
  for (const input of baseInputs) {
    input.addEventListener('change', () => showBasemap(input.value));
  }

  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
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
    mapElement.classList.toggle('is-measuring', drawing);
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
    if (!drawing) return;
    if (mode === 'coordinate') points = [point];
    else if (!points.at(-1)?.equals(point)) points.push(point);
    renderMeasurement();
  }

  map.on('click', ({ latlng }) => placePoint(latlng));
  mapElement.addEventListener('keydown', (event) => {
    if (event.target === mapElement && event.key === 'Enter' && drawing) {
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
