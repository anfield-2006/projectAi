// PSU Phuket Route Finder
// Geocoding: Photon (Komoot) | Routing: OSRM demo server | Map: Leaflet + OpenStreetMap

const DESTINATION = {
  name: 'มหาวิทยาลัยสงขลานครินทร์ วิทยาเขตภูเก็ต',
  lat: 7.89403,
  lon: 98.35281,
  address: '80 หมู่ 1 ถนนวิชิตสงคราม อำเภอกะทู้ จังหวัดภูเก็ต 83120'
};

const startInput = document.getElementById('startPoint');
const suggestionsBox = document.getElementById('suggestions');
const form = document.getElementById('routeForm');
const searchButton = document.getElementById('searchButton');
const statusMessage = document.getElementById('statusMessage');
const preference = document.getElementById('preference');
const resultsSection = document.getElementById('resultsSection');
const routeSummary = document.getElementById('routeSummary');
const routeList = document.getElementById('routeList');
const resultCount = document.getElementById('resultCount');
const googleMapsLink = document.getElementById('googleMapsLink');

let selectedStart = null;
let suggestionTimer = null;
let currentRoutes = [];
let selectedRouteIndex = 0;
let startMarker = null;
let destinationMarker = null;
let routeLayers = [];

const map = L.map('map', { scrollWheelZoom: false }).setView([DESTINATION.lat, DESTINATION.lon], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
}).addTo(map);

function markerIcon(letter, type) {
  return L.divIcon({
    className: '',
    html: `<div class="marker-label ${type}"><span>${letter}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 27],
    popupAnchor: [0, -25]
  });
}

destinationMarker = L.marker([DESTINATION.lat, DESTINATION.lon], { icon: markerIcon('B', 'marker-end') })
  .addTo(map)
  .bindPopup(`<strong>${DESTINATION.name}</strong><br>${DESTINATION.address}`);
destinationMarker.openPopup();

function setStatus(message, type = 'error') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
}

function clearStatus() {
  statusMessage.textContent = '';
  statusMessage.className = 'status-message';
}

function featureToPlace(feature) {
  const [lon, lat] = feature.geometry.coordinates;
  const p = feature.properties || {};
  const name = p.name || p.street || p.city || 'สถานที่ที่เลือก';
  const detail = [p.district, p.city, p.state].filter((v, i, a) => v && a.indexOf(v) === i && v !== name).join(', ');
  return { name: detail ? `${name}, ${detail}` : name, lat, lon };
}

function renderSuggestions(features) {
  suggestionsBox.innerHTML = '';
  if (!features.length) {
    suggestionsBox.hidden = true;
    return;
  }
  features.forEach((feature) => {
    const place = featureToPlace(feature);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion-item';
    button.setAttribute('role', 'option');
    button.textContent = place.name;
    const detail = document.createElement('small');
    detail.textContent = 'เลือกสถานที่นี้เป็นจุดเริ่มต้น';
    button.appendChild(detail);
    button.addEventListener('click', () => {
      selectedStart = place;
      startInput.value = place.name;
      suggestionsBox.hidden = true;
      clearStatus();
    });
    suggestionsBox.appendChild(button);
  });
  suggestionsBox.hidden = false;
}

startInput.addEventListener('input', () => {
  selectedStart = null;
  clearTimeout(suggestionTimer);
  const query = startInput.value.trim();
  if (query.length < 3) {
    suggestionsBox.hidden = true;
    return;
  }
  suggestionTimer = setTimeout(async () => {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=th`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('ค้นหาสถานที่ไม่สำเร็จ');
      const data = await response.json();
      // Ignore stale responses when the user has continued typing.
      if (startInput.value.trim() === query) renderSuggestions(data.features || []);
    } catch (error) {
      suggestionsBox.hidden = true;
    }
  }, 450);
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.field-group')) suggestionsBox.hidden = true;
});

async function geocodePlace(query) {
  const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=th`);
  if (!response.ok) throw new Error('ระบบค้นหาสถานที่ขัดข้อง กรุณาลองอีกครั้ง');
  const data = await response.json();
  if (!data.features || !data.features.length) throw new Error('ไม่พบสถานที่นี้ ลองพิมพ์ชื่อสถานที่หรือจังหวัดให้ละเอียดขึ้น');
  return featureToPlace(data.features[0]);
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '-';
  if (meters >= 1000) return (meters / 1000).toFixed(1);
  return Math.round(meters).toString();
}

function distanceUnit(meters) {
  return meters >= 1000 ? 'กม.' : 'ม.';
}

function formatDuration(seconds) {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours} ชม. ${minutes} นาที`;
  if (hours) return `${hours} ชม.`;
  return `${minutes} นาที`;
}

function getBestRouteIndex(routes, mode) {
  let bestIndex = 0;
  routes.forEach((route, index) => {
    const current = mode === 'fastest' ? route.duration : route.distance;
    const best = mode === 'fastest' ? routes[bestIndex].duration : routes[bestIndex].distance;
    if (current < best) bestIndex = index;
  });
  return bestIndex;
}

async function requestRoutes(start) {
  const coordinates = `${start.lon},${start.lat};${DESTINATION.lon},${DESTINATION.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?alternatives=3&overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('ไม่สามารถคำนวณเส้นทางได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง');
  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
    throw new Error('ไม่พบเส้นทางรถยนต์ระหว่างจุดเริ่มต้นกับมหาวิทยาลัย');
  }
  return data.routes;
}

function updateMarkers(start) {
  if (startMarker) map.removeLayer(startMarker);
  startMarker = L.marker([start.lat, start.lon], { icon: markerIcon('A', 'marker-start') })
    .addTo(map)
    .bindPopup(`<strong>จุดเริ่มต้น</strong><br>${start.name}`);
}

function drawRoutes(selectedIndex) {
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers = [];
  currentRoutes.forEach((route, index) => {
    const latLngs = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    const isSelected = index === selectedIndex;
    const layer = L.polyline(latLngs, {
      color: isSelected ? '#2469b4' : '#9aaabd',
      weight: isSelected ? 6 : 4,
      opacity: isSelected ? 0.95 : 0.72,
      dashArray: isSelected ? null : '8 8',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
    layer.bindTooltip(isSelected ? 'เส้นทางที่เลือก' : `เส้นทางทางเลือก ${index + 1}`);
    layer.on('click', () => selectRoute(index));
    routeLayers.push(layer);
  });
  if (routeLayers.length) {
    const allBounds = L.featureGroup(routeLayers).getBounds();
    if (allBounds.isValid()) map.fitBounds(allBounds.pad(0.12), { maxZoom: 15 });
  }
}

function renderSummary(route) {
  routeSummary.innerHTML = `
    <div class="summary-card highlight"><div class="summary-label">ระยะทางของเส้นทางที่เลือก</div><div class="summary-value">${formatDistance(route.distance)}<span class="summary-unit">${distanceUnit(route.distance)}</span></div></div>
    <div class="summary-card"><div class="summary-label">เวลาเดินทางโดยประมาณ</div><div class="summary-value">${formatDuration(route.duration)}</div></div>
    <div class="summary-card"><div class="summary-label">จำนวนเส้นทางที่พบ</div><div class="summary-value">${currentRoutes.length}<span class="summary-unit">เส้นทาง</span></div></div>
  `;
}

function renderRouteCards() {
  const mode = preference.value;
  routeList.innerHTML = '';
  currentRoutes.forEach((route, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `route-card ${index === selectedRouteIndex ? 'selected' : ''}`;
    const routeName = index === selectedRouteIndex ? 'เส้นทางที่แนะนำ' : `เส้นทางทางเลือก ${index + 1}`;
    const bestText = index === selectedRouteIndex ? '<span class="best-badge">เหมาะที่สุดตามที่เลือก</span>' : '';
    card.innerHTML = `
      <div class="route-card-top"><span class="route-name">${routeName}</span>${bestText}</div>
      <div class="route-card-stats">
        <div class="route-stat"><strong>${formatDistance(route.distance)} ${distanceUnit(route.distance)}</strong><small>ระยะทาง</small></div>
        <div class="route-stat"><strong>${formatDuration(route.duration)}</strong><small>เวลาโดยประมาณ</small></div>
      </div>
      <div class="route-card-note">${index === selectedRouteIndex ? (mode === 'shortest' ? 'ระยะทางน้อยที่สุดจากตัวเลือกที่ระบบพบ' : 'ใช้เวลาเดินทางน้อยที่สุดจากตัวเลือกที่ระบบพบ') : 'คลิกเพื่อดูเส้นทางนี้บนแผนที่'}</div>
    `;
    card.addEventListener('click', () => selectRoute(index));
    routeList.appendChild(card);
  });
}

function updateGoogleMapsLink(start) {
  const origin = `${start.lat},${start.lon}`;
  const destination = `${DESTINATION.lat},${DESTINATION.lon}`;
  googleMapsLink.href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

function selectRoute(index) {
  selectedRouteIndex = index;
  drawRoutes(index);
  renderSummary(currentRoutes[index]);
  renderRouteCards();
}

async function calculate(start) {
  searchButton.disabled = true;
  searchButton.querySelector('span').textContent = 'กำลังคำนวณเส้นทาง...';
  setStatus('กำลังค้นหาเส้นทางจากจุดเริ่มต้นไปยังมหาวิทยาลัย', 'success');
  resultsSection.hidden = true;
  try {
    const routes = await requestRoutes(start);
    const mode = preference.value;
    currentRoutes = routes;
    selectedRouteIndex = getBestRouteIndex(routes, mode);
    updateMarkers(start);
    destinationMarker.closePopup();
    drawRoutes(selectedRouteIndex);
    renderSummary(currentRoutes[selectedRouteIndex]);
    renderRouteCards();
    resultCount.textContent = `พบ ${currentRoutes.length} เส้นทาง`;
    updateGoogleMapsLink(start);
    resultsSection.hidden = false;
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('คำนวณเส้นทางเรียบร้อยแล้ว เลือกดูเส้นทางอื่นได้จากรายการด้านล่าง', 'success');
  } catch (error) {
    setStatus(error.message || 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง');
  } finally {
    searchButton.disabled = false;
    searchButton.querySelector('span').textContent = 'ค้นหาเส้นทางที่ดีที่สุด';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  suggestionsBox.hidden = true;
  clearStatus();
  const query = startInput.value.trim();
  if (!query) {
    setStatus('กรุณากรอกจุดเริ่มต้นก่อนค้นหา');
    startInput.focus();
    return;
  }
  try {
    const start = selectedStart && selectedStart.name === query ? selectedStart : await geocodePlace(query);
    selectedStart = start;
    await calculate(start);
  } catch (error) {
    setStatus(error.message || 'ไม่สามารถค้นหาจุดเริ่มต้นได้');
  }
});

document.getElementById('useLocation').addEventListener('click', () => {
  clearStatus();
  if (!navigator.geolocation) {
    setStatus('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง GPS');
    return;
  }
  setStatus('กำลังขอตำแหน่งปัจจุบันจากอุปกรณ์...', 'success');
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      selectedStart = { name: 'ตำแหน่งปัจจุบันของฉัน', lat: latitude, lon: longitude };
      startInput.value = selectedStart.name;
      suggestionsBox.hidden = true;
      await calculate(selectedStart);
    },
    (error) => {
      const message = error.code === 1 ? 'คุณยังไม่ได้อนุญาตให้เว็บไซต์เข้าถึงตำแหน่ง' : 'ไม่สามารถระบุตำแหน่งได้ กรุณาลองอีกครั้งหรือพิมพ์สถานที่เอง';
      setStatus(message);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
});

preference.addEventListener('change', () => {
  if (!currentRoutes.length) return;
  selectedRouteIndex = getBestRouteIndex(currentRoutes, preference.value);
  selectRoute(selectedRouteIndex);
});

// Ensure the map tiles render correctly after the responsive layout settles.
window.addEventListener('load', () => setTimeout(() => map.invalidateSize(), 150));
window.addEventListener('resize', () => map.invalidateSize());
