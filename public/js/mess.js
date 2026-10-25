/**
 * Mess Portal Logic
 */

let currentTab = 'claimed';
let allListings = [];
let currentMessUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verify Authentication
  currentMessUser = await getCurrentUser();
  if (!currentMessUser || currentMessUser.role !== 'mess') {
    showToast('Please log in with your Mess credentials', 'info');
    setTimeout(() => {
      window.location.href = '/auth?role=mess&tab=login';
    }, 400);
    return;
  }

  // 2. Set Header & Banner Profile Data
  document.getElementById('mess-org-name').textContent = `${currentMessUser.name} (${currentMessUser.org_type || 'Mess'})`;
  document.getElementById('mess-banner-title').textContent = currentMessUser.name;
  document.getElementById('mess-banner-address').innerHTML = `<span>📍</span> <span>${escapeHtml(currentMessUser.address)}, ${escapeHtml(currentMessUser.city || '')}${currentMessUser.state ? ', ' + escapeHtml(currentMessUser.state) : ''}</span>`;
  document.getElementById('mess-banner-phone').textContent = currentMessUser.phone || '-';
  document.getElementById('mess-banner-contact').textContent = currentMessUser.contact_person || currentMessUser.name;

  // 3. Set default upload times
  resetUploadFormTimes();

  // 4. Fetch Stats & Listings
  await refreshDashboard();

  // Auto-refresh every 20 seconds to catch NGO claims live
  setInterval(refreshDashboard, 20000);
});

// Refresh all listings and stats
async function refreshDashboard() {
  await Promise.all([loadMessStats(), loadMessListings()]);
}

// Load statistics
async function loadMessStats() {
  try {
    const res = await fetch('/api/mess/stats');
    const data = await res.json();
    if (data.stats) {
      document.getElementById('stat-plates-saved').textContent = data.stats.total_plates_saved || 0;
      document.getElementById('stat-active-count').textContent = data.stats.active_listings || 0;
      document.getElementById('stat-claimed-count').textContent = data.stats.awaiting_pickup || 0;
      document.getElementById('stat-completed-count').textContent = data.stats.total_donations_completed || 0;

      // Update tab badges
      document.getElementById('badge-available-count').textContent = data.stats.active_listings || 0;
      const claimedBadge = document.getElementById('badge-claimed-count');
      claimedBadge.textContent = data.stats.awaiting_pickup || 0;
      if (data.stats.awaiting_pickup > 0) {
        claimedBadge.classList.remove('hidden');
      } else {
        claimedBadge.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Stats fetch error:', err);
  }
}

// Load listings
async function loadMessListings() {
  try {
    const res = await fetch('/api/mess/listings');
    const data = await res.json();
    allListings = data.listings || [];
    renderTabContent();
  } catch (err) {
    console.error('Listings fetch error:', err);
  }
}

// Switch Tab
function setTab(tab) {
  currentTab = tab;

  // Update tab button styles
  const tabs = ['claimed', 'available', 'picked_up', 'expired'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-${t}`);
    if (!btn) return;
    if (t === tab) {
      btn.className = 'px-6 py-4 border-b-2 border-amber-600 text-amber-700 bg-white flex items-center gap-2 whitespace-nowrap font-bold';
    } else {
      btn.className = 'px-6 py-4 border-b-2 border-transparent text-slate-600 hover:text-slate-900 flex items-center gap-2 whitespace-nowrap font-bold';
    }
  });

  renderTabContent();
}

// Render Listings based on Active Tab
function renderTabContent() {
  const container = document.getElementById('listings-container');
  const filtered = allListings.filter(l => l.status === currentTab);

  if (filtered.length === 0) {
    let emptyMsg = 'No food listings in this category.';
    if (currentTab === 'claimed') {
      emptyMsg = 'No active NGO claims right now. When an NGO claims your surplus food, their pickup details will show up here!';
    } else if (currentTab === 'available') {
      emptyMsg = 'No active surplus food listed right now. Click "+ Upload Today\'s Extra Food" to share extra plates!';
    } else if (currentTab === 'picked_up') {
      emptyMsg = 'No completed food handovers yet. As NGOs collect food, they are logged here.';
    } else if (currentTab === 'expired') {
      emptyMsg = 'No expired food listings. Great job donating food on time!';
    }

    container.innerHTML = `
      <div class="text-center py-12 px-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
        <span class="text-3xl">📦</span>
        <p class="text-slate-700 font-bold mt-2 text-sm">${emptyMsg}</p>
        ${currentTab === 'available' ? `
          <button onclick="openUploadModal()" class="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-sm transition">
            + Upload Surplus Food Now
          </button>
        ` : ''}
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const fresh = formatFreshness(item.fresh_till);
    const typeBadge = item.food_type === 'veg' 
      ? '<span class="px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">🥬 Pure Veg</span>'
      : '<span class="px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800">🍗 Non-Veg</span>';

    // Different card design based on status
    if (item.status === 'claimed') {
      return `
        <div class="bg-blue-50/50 rounded-2xl border-2 border-blue-200 p-6 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div class="flex-1">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-600 text-white flex items-center gap-1">
                🚨 CLAIMED - NGO ARRIVING
              </span>
              ${typeBadge}
              <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${fresh.badgeClass}">
                ${fresh.icon} ${fresh.text}
              </span>
            </div>

            <h3 class="text-xl font-bold text-slate-900">${escapeHtml(item.title)}</h3>
            <div class="text-emerald-700 font-extrabold text-lg mt-1">${item.plates_count} Plates</div>

            <!-- NGO Claim Details Card -->
            <div class="mt-4 p-4 bg-white rounded-xl border border-blue-200 text-sm space-y-2">
              <div class="font-bold text-blue-950 flex items-center gap-2">
                <span>🤝 Claiming NGO:</span>
                <span class="text-base text-blue-900 font-extrabold">${escapeHtml(item.claimed_ngo_name || 'Verified NGO')}</span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span class="text-slate-500 font-semibold">Contact Person:</span>
                  <span class="text-slate-800 font-bold">${escapeHtml(item.claimed_ngo_contact || 'Volunteer')}</span>
                </div>
                <div>
                  <span class="text-slate-500 font-semibold">Phone:</span>
                  <a href="tel:${escapeHtml(item.claimed_ngo_phone)}" class="text-blue-700 font-bold underline">
                    📞 ${escapeHtml(item.claimed_ngo_phone || 'Call NGO')}
                  </a>
                </div>
                <div>
                  <span class="text-slate-500 font-semibold">Estimated Arrival:</span>
                  <span class="text-amber-700 font-bold">⏱️ ${escapeHtml(item.estimated_pickup_time || 'Soon')}</span>
                </div>
                <div>
                  <span class="text-slate-500 font-semibold">Pickup Notes:</span>
                  <span class="text-slate-700">${escapeHtml(item.ngo_notes || 'None')}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row lg:flex-col gap-2 w-full lg:w-48 shrink-0">
            <button onclick="updateStatus(${item.id}, 'picked_up')" class="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md text-xs transition flex items-center justify-center gap-1.5">
              <span>✅</span> Handed Over / Collected
            </button>
            <button onclick="updateStatus(${item.id}, 'available')" class="w-full py-2.5 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold rounded-xl text-xs transition text-center">
              Revert to Available
            </button>
          </div>
        </div>
      `;
    }

    // Available or Completed or Expired
    return `
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm card-hover flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div class="flex-1">
          <div class="flex flex-wrap items-center gap-2 mb-2">
            ${typeBadge}
            <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${fresh.badgeClass}">
              ${fresh.icon} ${fresh.text}
            </span>
            <span class="text-xs text-slate-400">Cooked: ${formatDateTime(item.cooked_at)}</span>
          </div>

          <h3 class="text-lg font-bold text-slate-900">${escapeHtml(item.title)}</h3>
          <p class="text-xs text-slate-500 mt-1">${escapeHtml(item.description || 'Nutritious surplus meal.')}</p>

          <div class="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <div class="font-extrabold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
              Quantity: ${item.plates_count} Plates
            </div>
            <div class="text-slate-600">
              <span class="font-semibold text-slate-500">Packaging:</span> ${escapeHtml(item.packaging_type)}
            </div>
            ${item.pickup_instructions ? `
              <div class="text-slate-600">
                <span class="font-semibold text-slate-500">Pickup Instructions:</span> ${escapeHtml(item.pickup_instructions)}
              </div>
            ` : ''}
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          ${item.status === 'available' ? `
            <button onclick="deleteListing(${item.id})" class="px-3 py-2 text-red-600 hover:bg-red-50 font-bold text-xs rounded-lg border border-red-200 transition">
              Remove
            </button>
          ` : ''}
          ${item.status === 'picked_up' ? `
            <span class="px-3 py-1.5 bg-emerald-50 text-emerald-800 font-bold text-xs rounded-lg border border-emerald-200">
              ✓ Successfully Donated
            </span>
          ` : ''}
          ${item.status === 'expired' ? `
            <span class="px-3 py-1.5 bg-slate-100 text-slate-500 font-bold text-xs rounded-lg">
              Expired
            </span>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Update status (e.g. marked as picked up)
async function updateStatus(id, newStatus) {
  try {
    const res = await fetch(`/api/mess/listings/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to update status', 'error');
      return;
    }
    showToast(data.message, 'success');
    await refreshDashboard();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// Delete listing
async function deleteListing(id) {
  if (!confirm('Are you sure you want to remove this surplus food listing?')) return;

  try {
    const res = await fetch(`/api/mess/listings/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to delete listing', 'error');
      return;
    }
    showToast('Listing removed', 'info');
    await refreshDashboard();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// Upload Modal Logic
function openUploadModal() {
  resetUploadFormTimes();
  if (currentMessUser && currentMessUser.address) {
    document.getElementById('food-pickup-instructions').value = `Pick up at ${currentMessUser.address}. Call ${currentMessUser.phone} upon arrival.`;
  }
  document.getElementById('upload-modal').classList.remove('hidden');
}

function closeUploadModal() {
  document.getElementById('upload-modal').classList.add('hidden');
}

function formatDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

function resetUploadFormTimes() {
  const now = new Date();
  const defaultCooked = new Date(now.getTime() - 45 * 60 * 1000); // 45 mins ago
  const defaultFreshTill = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours from now

  const cookedInput = document.getElementById('food-cooked');
  const freshTillInput = document.getElementById('food-fresh-till');

  if (cookedInput) cookedInput.value = formatDatetimeLocal(defaultCooked);
  if (freshTillInput) freshTillInput.value = formatDatetimeLocal(defaultFreshTill);
}

function setFreshnessHours(hours) {
  const now = new Date();
  const target = new Date(now.getTime() + hours * 60 * 60 * 1000);
  document.getElementById('food-fresh-till').value = formatDatetimeLocal(target);
  showToast(`Freshness set for +${hours} hours from now`, 'info');
}

// Handle Form Submit
async function handleFoodUploadSubmit(e) {
  e.preventDefault();

  const title = document.getElementById('food-title').value;
  const plates_count = document.getElementById('food-plates').value;
  const food_type = document.getElementById('food-type').value;
  const cooked_at = document.getElementById('food-cooked').value;
  const fresh_till = document.getElementById('food-fresh-till').value;
  const packaging_type = document.getElementById('food-packaging').value;
  const special_notes = document.getElementById('food-notes').value;
  const description = document.getElementById('food-description').value;
  const pickup_instructions = document.getElementById('food-pickup-instructions').value;

  const btn = document.getElementById('btn-submit-upload');
  btn.disabled = true;
  btn.innerHTML = 'Publishing...';

  try {
    const res = await fetch('/api/mess/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, plates_count, food_type, cooked_at, fresh_till,
        packaging_type, special_notes, description, pickup_instructions
      })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to upload food listing', 'error');
      btn.disabled = false;
      btn.innerHTML = 'Publish Surplus Food Listing';
      return;
    }

    showToast('Surplus food published! Nearby NGOs can now see and claim it.', 'success');
    closeUploadModal();
    // Reset inputs
    document.getElementById('food-title').value = '';
    document.getElementById('food-plates').value = '';
    document.getElementById('food-description').value = '';
    btn.disabled = false;
    btn.innerHTML = 'Publish Surplus Food Listing';

    // Switch to active surplus tab and reload
    currentTab = 'available';
    setTab('available');
    await refreshDashboard();
  } catch (err) {
    showToast('Upload error: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = 'Publish Surplus Food Listing';
  }
}
