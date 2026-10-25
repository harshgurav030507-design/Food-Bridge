/**
 * FoodBridge Common Utilities
 */

// Toast Notifications
function showToast(message, type = 'success', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconSvg = type === 'error'
    ? `<svg class="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
    : type === 'info'
    ? `<svg class="w-5 h-5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
    : `<svg class="w-5 h-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;

  toast.innerHTML = `
    ${iconSvg}
    <div class="text-sm font-medium text-slate-800 flex-1 leading-snug">${escapeHtml(message)}</div>
    <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Escape HTML for XSS prevention
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Session check
async function getCurrentUser() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    return data.user;
  } catch (err) {
    console.error('Session check error:', err);
    return null;
  }
}

// Logout
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    showToast('Logged out successfully', 'info');
    setTimeout(() => {
      window.location.href = '/';
    }, 500);
  } catch (err) {
    console.error('Logout error:', err);
  }
}

// Reverse Geocoding helper (Autofill City & State from Lat/Lon via Nominatim OpenStreetMap)
async function reverseGeocode(latitude, longitude) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=14&addressdetails=1`, {
      headers: { 'Accept-Language': 'en' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.address) {
      const a = data.address;
      // Extract best match for city
      const city = a.city || a.town || a.village || a.suburb || a.municipality || a.county || a.district || '';
      // Extract state
      const state = a.state || a.state_district || a.region || '';
      const pincode = a.postcode || '';
      const road = a.road || a.neighbourhood || '';
      return { city, state, pincode, road, displayName: data.display_name };
    }
  } catch (err) {
    console.warn('Reverse geocode lookup warning:', err);
  }
  return null;
}

// Format Freshness with Urgency Badges
function formatFreshness(freshTillIso) {
  const now = new Date();
  const expiry = new Date(freshTillIso);
  const diffMs = expiry - now;

  if (diffMs <= 0) {
    return {
      text: 'Expired',
      badgeClass: 'bg-slate-100 text-slate-500 border border-slate-300',
      icon: '⏰',
      isExpired: true,
      remainingMinutes: 0
    };
  }

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  let timeString = '';
  if (hours > 0) {
    timeString = `${hours}h ${minutes > 0 ? minutes + 'm' : ''}`;
  } else {
    timeString = `${minutes} mins`;
  }

  if (totalMinutes < 60) {
    // Under 1 hour: Urgent!
    return {
      text: `Urgent! Fresh for ${timeString}`,
      badgeClass: 'badge-urgent font-bold',
      icon: '⚡',
      isExpired: false,
      remainingMinutes: totalMinutes
    };
  } else if (totalMinutes < 180) {
    // 1 to 3 hours
    return {
      text: `Fresh for ${timeString}`,
      badgeClass: 'badge-medium font-semibold',
      icon: '⏳',
      isExpired: false,
      remainingMinutes: totalMinutes
    };
  } else {
    // 3+ hours
    return {
      text: `Fresh for ${timeString}`,
      badgeClass: 'badge-fresh font-semibold',
      icon: '🌿',
      isExpired: false,
      remainingMinutes: totalMinutes
    };
  }
}

// Distance badge formatting
function formatDistance(distKm) {
  if (distKm == null) {
    return {
      text: 'Location set',
      badgeClass: 'bg-slate-100 text-slate-600'
    };
  }

  if (distKm <= 1.0) {
    return {
      text: `📍 ${distKm} km (Super Close!)`,
      badgeClass: 'badge-closest font-bold ring-2 ring-emerald-400/40'
    };
  } else if (distKm <= 3.5) {
    return {
      text: `📍 ${distKm} km away`,
      badgeClass: 'bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold'
    };
  } else {
    return {
      text: `📍 ${distKm} km away`,
      badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200 font-medium'
    };
  }
}

// Human readable time formatter
function formatDateTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ')';
}

// Browser Geolocation Helper
function detectUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: parseFloat(pos.coords.latitude.toFixed(6)),
          longitude: parseFloat(pos.coords.longitude.toFixed(6))
        });
      },
      (err) => {
        reject(err);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  });
}
