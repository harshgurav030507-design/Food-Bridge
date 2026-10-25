/**
 * NGO & Orphanage Portal Logic
 */

let currentNgoUser = null;
let currentListings = [];
let interactiveMap = null;
let mapMarkers = [];
let isMapVisible = false;
let filterTimeout = null;

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verify Authentication
  currentNgoUser = await getCurrentUser();
    if (!currentNgoUser || currentNgoUser.role !== 'ngo') {
    window.location.replace('/auth?role=ngo&tab=login');
    return;
  }

  // 2. Set Profile Data & Location Text
  document.getElementById('ngo-org-name').textContent = `${currentNgoUser.name} (${currentNgoUser.org_type || 'NGO'})`;
  document.getElementById('ngo-location-text').innerHTML = `
    <span>📍</span> <span>Registered at: ${escapeHtml(currentNgoUser.address)}, ${escapeHtml(currentNgoUser.city)}</span>
  `;

  // 3. Load Available Food with Proximity Ranking
  await fetchAvailableFood();

  // 4. Update claim badge counter
  await updateClaimsBadge();

  // Periodic refresh every 30 seconds
  setInterval(async () => {
    await fetchAvailableFood(true);
    await updateClaimsBadge();
  }, 30000);
});

// Switch between Browse Feed and My Claims view
function switchViewMode(mode) {
  const feedSec = document.getElementById('section-feed');
  const claimsSec = document.getElementById('section-claims');
  const feedBtn = document.getElementById('view-feed-btn');
  const claimsBtn = document.getElementById('view-claims-btn');

  if (mode === 'feed') {
    feedSec.classList.remove('hidden');
    claimsSec.classList.add('hidden');
    feedBtn.className = 'px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-sm transition';
    claimsBtn.className = 'px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition';
  } else {
    feedSec.classList.add('hidden');
    claimsSec.classList.remove('hidden');
    claimsBtn.className = 'px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-sm transition';
    feedBtn.className = 'px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition';
    loadMyClaims();
  }
}

// Debounce for search filter
function debounceFilter() {
  clearTimeout(filterTimeout);
  filterTimeout = setTimeout(() => {
    fetchAvailableFood();
  }, 300);
}

// Fetch available surplus food
async function fetchAvailableFood(silent = false) {
  const search = document.getElementById('filter-search').value.trim();
  const foodType = document.getElementById('filter-food-type').value;
  const sort = document.getElementById('filter-sort').value;
  const maxDist = document.getElementById('filter-max-dist').value;

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (foodType && foodType !== 'all') params.append('food_type', foodType);
  if (sort) params.append('sort', sort);
  if (maxDist) params.append('max_dist', maxDist);

  try {
    const res = await fetch(`/api/ngo/available-food?${params.toString()}`);
    const data = await res.json();
    currentListings = data.listings || [];

    renderFoodFeed(currentListings);

    // Update map markers if map is visible
    if (isMapVisible && interactiveMap) {
      updateMapMarkers(currentListings);
    }
  } catch (err) {
    console.error('Fetch food error:', err);
    if (!silent) showToast('Failed to load available food: ' + err.message, 'error');
  }
}

// Render available food feed
function renderFoodFeed(listings) {
  const grid = document.getElementById('food-cards-grid');

  if (listings.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-sm">
        <span class="text-4xl">🍲</span>
        <h3 class="text-lg font-bold text-slate-900 mt-3">No Surplus Food Matches Your Filter</h3>
        <p class="text-xs text-slate-500 mt-1 max-w-md mx-auto">
          Messes post extra meals after lunch (1:30 PM - 3:30 PM) and dinner (8:30 PM - 10:30 PM). Try broadening your search or distance radius.
        </p>
      </div>
    `;
    return;
  }

  grid.innerHTML = listings.map(item => {
    const fresh = formatFreshness(item.fresh_till);
    const dist = formatDistance(item.distance_km);
    const isVeg = item.food_type === 'veg';
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${item.mess_latitude},${item.mess_longitude}`;

    return `
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm card-hover flex flex-col justify-between">
        <div>
          <!-- Proximity & Freshness Badges -->
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs ${dist.badgeClass}">
              ${dist.text}
            </span>
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs ${fresh.badgeClass}">
              ${fresh.icon} ${fresh.text}
            </span>
          </div>

          <!-- Quantity Highlight & Food Type -->
          <div class="flex items-center justify-between gap-2 mt-1 mb-2">
            <div class="text-xl font-extrabold text-emerald-700">
              ${item.plates_count} <span class="text-xs font-bold text-emerald-900">Plates Available</span>
            </div>
            <span class="px-2 py-0.5 rounded text-[11px] font-bold ${isVeg ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">
              ${isVeg ? '🥬 Pure Veg' : '🍗 Non-Veg'}
            </span>
          </div>

          <!-- Food Title & Description -->
          <h3 class="text-base font-bold text-slate-900 line-clamp-2">${escapeHtml(item.title)}</h3>
          <p class="text-xs text-slate-500 mt-1.5 line-clamp-2">${escapeHtml(item.description || 'Cooked in hygienic hostel/college mess kitchen.')}</p>

          <!-- Mess Location & Details -->
          <div class="mt-4 p-3 bg-slate-50 rounded-xl space-y-1.5 text-xs border border-slate-100">
            <div class="flex items-center justify-between">
              <span class="text-slate-500 font-semibold">Mess Name:</span>
              <span class="text-slate-800 font-bold truncate max-w-[170px]">${escapeHtml(item.mess_name)}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-slate-500 font-semibold">Pickup Address:</span>
              <span class="text-slate-700 truncate max-w-[170px]" title="${escapeHtml(item.mess_address)}">${escapeHtml(item.mess_address)}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-slate-500 font-semibold">Packaging:</span>
              <span class="text-slate-700 font-medium">${escapeHtml(item.packaging_type)}</span>
            </div>
            ${item.special_notes ? `
              <div class="text-[11px] text-amber-800 bg-amber-50/80 p-1.5 rounded">
                💡 ${escapeHtml(item.special_notes)}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="mt-5 pt-3 border-t border-slate-100 flex items-center gap-2">
          <button onclick="openClaimModal(${item.id})" class="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md shadow-emerald-600/20 transition flex items-center justify-center gap-1.5">
            <span>🤝</span> Claim This Food (Free)
          </button>
          <a href="${mapsUrl}" target="_blank" title="Open Google Maps Directions" class="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition flex items-center justify-center">
            🧭 Map
          </a>
        </div>
      </div>
    `;
  }).join('');
}

// Toggle Interactive Map View
function toggleMapView() {
  const mapWrapper = document.getElementById('map-wrapper');
  const toggleBtnText = document.getElementById('map-toggle-text');

  isMapVisible = !isMapVisible;

  if (isMapVisible) {
    mapWrapper.classList.remove('hidden');
    toggleBtnText.textContent = 'Hide Map View';
    setTimeout(() => {
      initInteractiveMap();
    }, 150);
  } else {
    mapWrapper.classList.add('hidden');
    toggleBtnText.textContent = 'Show Map View';
  }
}

// Initialize Leaflet Map
function initInteractiveMap() {
  if (interactiveMap) {
    interactiveMap.invalidateSize();
    updateMapMarkers(currentListings);
    return;
  }

  const ngoLat = currentNgoUser.latitude || 28.5475;
  const ngoLon = currentNgoUser.longitude || 77.1980;

  interactiveMap = L.map('interactive-map').setView([ngoLat, ngoLon], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(interactiveMap);

  // NGO Home Pin
  const ngoIcon = L.divIcon({
    className: 'custom-ngo-pin',
    html: `<div style="background:#16a34a;color:white;padding:6px 10px;border-radius:20px;font-weight:bold;font-size:11px;border:2px solid white;box-shadow:0 3px 8px rgba(0,0,0,0.3);white-space:nowrap;">🏠 Your Location</div>`,
    iconSize: [100, 30],
    iconAnchor: [50, 15]
  });

  L.marker([ngoLat, ngoLon], { icon: ngoIcon })
    .addTo(interactiveMap)
    .bindPopup(`<b>${escapeHtml(currentNgoUser.name)}</b><br>${escapeHtml(currentNgoUser.address)}`);

  updateMapMarkers(currentListings);
}

// Update Map Pins for Available Listings
function updateMapMarkers(listings) {
  if (!interactiveMap) return;

  // Clear existing markers
  mapMarkers.forEach(m => interactiveMap.removeLayer(m));
  mapMarkers = [];

  listings.forEach(item => {
    if (!item.mess_latitude || !item.mess_longitude) return;

    const foodIcon = L.divIcon({
      className: 'custom-mess-pin',
      html: `
        <div style="background:#ea580c;color:white;padding:4px 8px;border-radius:12px;font-weight:bold;font-size:11px;border:2px solid white;box-shadow:0 3px 6px rgba(0,0,0,0.3);text-align:center;">
          🍲 ${item.plates_count} Plates
        </div>
      `,
      iconSize: [80, 26],
      iconAnchor: [40, 13]
    });

    const marker = L.marker([item.mess_latitude, item.mess_longitude], { icon: foodIcon }).addTo(interactiveMap);

    const distText = item.distance_km != null ? `${item.distance_km} km away` : '';
    const popupContent = `
      <div style="font-family:sans-serif;font-size:12px;min-width:180px;">
        <b style="color:#0f172a;font-size:13px;">${escapeHtml(item.title)}</b><br>
        <div style="color:#16a34a;font-weight:bold;margin:3px 0;">${item.plates_count} Plates &bull; ${distText}</div>
        <div style="color:#475569;margin-bottom:6px;">Mess: ${escapeHtml(item.mess_name)}</div>
        <button onclick="openClaimModal(${item.id})" style="background:#16a34a;color:white;border:none;padding:5px 10px;border-radius:6px;font-weight:bold;cursor:pointer;width:100%;">
          Claim This Food
        </button>
      </div>
    `;

    marker.bindPopup(popupContent);
    mapMarkers.push(marker);
  });
}

// Claim Modal Logic
function openClaimModal(listingId) {
  const item = currentListings.find(l => l.id === listingId);
  if (!item) return;

  document.getElementById('claim-listing-id').value = item.id;
  const fresh = formatFreshness(item.fresh_till);

  document.getElementById('claim-food-summary').innerHTML = `
    <div class="font-bold text-slate-800 text-sm">${escapeHtml(item.title)}</div>
    <div class="text-emerald-700 font-extrabold">${item.plates_count} Plates &bull; ${item.food_type === 'veg' ? 'Pure Veg' : 'Non-Veg'}</div>
    <div class="text-slate-600"><strong>Mess:</strong> ${escapeHtml(item.mess_name)} (${item.distance_km != null ? item.distance_km + ' km away' : ''})</div>
    <div class="text-slate-600"><strong>Address:</strong> ${escapeHtml(item.mess_address)}, ${escapeHtml(item.mess_city)}</div>
    <div class="text-amber-700 font-semibold">${fresh.icon} ${fresh.text}</div>
  `;

  document.getElementById('claim-eta').value = 'Within 45 mins';
  document.getElementById('claim-notes').value = '';

  document.getElementById('claim-modal').classList.remove('hidden');
}

function closeClaimModal() {
  document.getElementById('claim-modal').classList.add('hidden');
}

function setEta(val) {
  document.getElementById('claim-eta').value = val;
}

// Submit Claim
async function handleClaimSubmit(e) {
  e.preventDefault();
  const listingId = document.getElementById('claim-listing-id').value;
  const estimated_pickup_time = document.getElementById('claim-eta').value;
  const ngo_notes = document.getElementById('claim-notes').value;
  const btn = document.getElementById('btn-confirm-claim');

  btn.disabled = true;
  btn.innerHTML = 'Claiming...';

  try {
    const res = await fetch(`/api/ngo/claim/${listingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estimated_pickup_time, ngo_notes })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to claim listing', 'error');
      btn.disabled = false;
      btn.innerHTML = '✅ Confirm Claim & Get Contact';
      return;
    }

    showToast('Food claimed! Mess has been notified of your pickup.', 'success');
    closeClaimModal();
    btn.disabled = false;
    btn.innerHTML = '✅ Confirm Claim & Get Contact';

    // Refresh feed and open "My Pickups"
    await fetchAvailableFood();
    await updateClaimsBadge();
    switchViewMode('my-claims');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '✅ Confirm Claim & Get Contact';
  }
}

// Load My Claims
async function loadMyClaims() {
  const container = document.getElementById('claims-container');
  try {
    const res = await fetch('/api/ngo/my-claims');
    const data = await res.json();
    const claims = data.claims || [];

    if (claims.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 px-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
          <span class="text-3xl">🚚</span>
          <p class="text-slate-700 font-bold mt-2 text-sm">No pickups or claims yet</p>
          <p class="text-xs text-slate-500 mt-1">Browse nearby surplus food and claim meals for your shelter or orphanage.</p>
          <button onclick="switchViewMode('feed')" class="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition">
            Browse Available Food
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = claims.map(item => {
      const isClaimed = item.status === 'claimed';
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${item.mess_latitude},${item.mess_longitude}`;
      const fresh = formatFreshness(item.fresh_till);

      return `
        <div class="rounded-2xl border ${isClaimed ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'} p-5 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div class="flex-1">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              ${isClaimed ? `
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-white">
                  ⏳ Pickup In Progress
                </span>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${fresh.badgeClass}">
                  ${fresh.icon} ${fresh.text}
                </span>
              ` : `
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                  ✅ Picked Up & Completed
                </span>
              `}
              <span class="text-xs text-slate-500">Claimed at: ${formatDateTime(item.claimed_at)}</span>
            </div>

            <h3 class="text-lg font-bold text-slate-900">${escapeHtml(item.title)}</h3>
            <div class="text-emerald-700 font-extrabold text-sm mt-0.5">${item.plates_count} Plates</div>

            <!-- Mess Coordinates & Contact Card -->
            <div class="mt-3 p-3 bg-white rounded-xl border border-slate-200 text-xs grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <span class="text-slate-500 font-semibold">Mess Name:</span>
                <span class="text-slate-900 font-bold">${escapeHtml(item.mess_name)}</span>
              </div>
              <div>
                <span class="text-slate-500 font-semibold">Mess Contact:</span>
                <a href="tel:${escapeHtml(item.mess_phone)}" class="text-emerald-700 font-bold underline">
                  📞 ${escapeHtml(item.mess_phone)}
                </a>
              </div>
              <div class="sm:col-span-2">
                <span class="text-slate-500 font-semibold">Pickup Address:</span>
                <span class="text-slate-800">${escapeHtml(item.mess_address)}, ${escapeHtml(item.mess_city)}</span>
              </div>
              ${item.pickup_instructions ? `
                <div class="sm:col-span-2 text-slate-600 bg-slate-50 p-2 rounded">
                  <strong>Instructions:</strong> ${escapeHtml(item.pickup_instructions)}
                </div>
              ` : ''}
            </div>
          </div>

          <div class="flex flex-col sm:flex-row lg:flex-col gap-2 w-full lg:w-44 shrink-0">
            <a href="${mapsUrl}" target="_blank" class="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs text-center shadow-sm transition flex items-center justify-center gap-1">
              🧭 Directions Map
            </a>
            <a href="tel:${escapeHtml(item.mess_phone)}" class="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs text-center shadow-sm transition flex items-center justify-center gap-1">
              📞 Call Mess
            </a>
            ${isClaimed ? `
              <button onclick="cancelClaim(${item.id})" class="w-full py-2 px-3 text-red-600 hover:bg-red-50 border border-red-200 font-semibold rounded-xl text-xs transition">
                Cancel Claim
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('My claims fetch error:', err);
  }
}

// Cancel Claim (frees food for other NGOs)
async function cancelClaim(listingId) {
  if (!confirm('Are you sure you want to cancel this claim? The surplus food will be made available for other NGOs to rescue.')) return;

  try {
    const res = await fetch(`/api/ngo/cancel-claim/${listingId}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to cancel claim', 'error');
      return;
    }
    showToast(data.message, 'info');
    await loadMyClaims();
    await updateClaimsBadge();
    await fetchAvailableFood(true);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// Update Claims Badge Counter
async function updateClaimsBadge() {
  try {
    const res = await fetch('/api/ngo/my-claims');
    const data = await res.json();
    const activePickups = (data.claims || []).filter(c => c.status === 'claimed').length;
    const badge = document.getElementById('my-claims-badge');
    if (activePickups > 0) {
      badge.textContent = activePickups;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (err) {
    console.error('Badge update error:', err);
  }
}

// Update My Location (GPS detection with City & State autofill)
async function updateMyLocation() {
  try {
    showToast('Detecting your current GPS location...', 'info');
    const coords = await detectUserLocation();

    // Autofill city and state via reverse geocoding
    const geo = await reverseGeocode(coords.latitude, coords.longitude);
    const updatePayload = {
      latitude: coords.latitude,
      longitude: coords.longitude
    };
    if (geo) {
      if (geo.city) updatePayload.city = geo.city;
      if (geo.state) updatePayload.state = geo.state;
    }

    const res = await fetch('/api/auth/update-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to update location', 'error');
      return;
    }

    currentNgoUser = data.user;
    const locText = (geo && geo.city) ? `${geo.city}${geo.state ? ', ' + geo.state : ''}` : `${currentNgoUser.city || ''}`;
    showToast(`Location updated to ${locText}! Re-ranking nearby messes...`, 'success');

    document.getElementById('ngo-location-text').innerHTML = `
      <span>📍</span> <span>Registered at: ${escapeHtml(currentNgoUser.address)}, ${escapeHtml(currentNgoUser.city || '')}${currentNgoUser.state ? ', ' + escapeHtml(currentNgoUser.state) : ''}</span>
    `;

    await fetchAvailableFood();

    if (interactiveMap) {
      interactiveMap.setView([coords.latitude, coords.longitude], 14);
      initInteractiveMap();
    }
  } catch (err) {
    showToast('Location detection error: ' + err.message, 'error');
  }
}
