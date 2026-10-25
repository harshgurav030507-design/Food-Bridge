# 🍲 FoodBridge — Surplus Food Rescue Platform

> **Connecting College & Local Messes with NGOs and Orphanages to eliminate plate waste and nourish communities.**

---

## 📌 Problem & Idea

Every day in college dining halls, hostel canteens, and local messes, **dozens to hundreds of plates of hygienic, freshly cooked food are discarded as waste**. At the same time, nearby orphanages, child care centers, and homeless shelters struggle to afford nutritious daily meals.

**FoodBridge** solves this with two dedicated portals:
1. **Mess Portal (Food Providers)**: College and hostel messes upload today's surplus food, quantity (plates count), and specify **till when it remains fresh** (expiry deadline).
2. **NGO & Orphanage Portal (Beneficiaries)**: NGOs view active surplus food listings **ranked by proximity (closest messes first)**, claim the food for free, and coordinate quick pickup before the food expires.

---

## 🌟 Key Features

### 👨‍🍳 1. Mess & Canteen Portal
* **Daily Authentication & Profile**: Secure login with email and password; stores mess name, physical address, city, state, contact person, 10-digit phone number, and GPS coordinates.
* **Upload Today's Extra Food in 60 Seconds**:
  * Dish name / menu items (e.g. *Dal Tadka, Steamed Rice, 40 Rotis, Mixed Sabzi*).
  * Number of plates / servings.
  * Food category (*Pure Veg, Non-Veg, Jain*).
  * Preparation / cooked time.
  * **"Fresh Till" Expiry Deadline** with quick +2h, +4h, +6h presets.
  * Packaging condition (e.g., *Bring own buckets/vessels, foil trays, meal boxes*).
  * Storage notes (e.g., *Kept warm in Bain-marie*).
  * Specific pickup gate / supervisor directions.
* **Real-Time Claim Alerts**: When an NGO claims food, the mess sees:
  * Name of the claiming orphanage / NGO.
  * Contact person & direct telephone call link (`tel:`).
  * Estimated volunteer arrival time & vehicle notes.
* **Status Lifecycle Management**:
  * `Available` ➔ `Claimed (NGO Arriving)` ➔ `Picked Up / Handed Over` (or `Expired` if past deadline).
* **Impact Metrics**: Total plates saved, active surplus, and completed handovers.

---

### 🤝 2. NGO & Orphanage Portal
* **Daily Authentication**: Registered with physical address, city, state, 10-digit phone, and latitude/longitude.
* **Autofill City & State on Location Fetch**: When detecting GPS location or picking a point on the interactive map, City and State are automatically resolved via reverse geocoding.
* **Proximity Recommendation Algorithm**:
  * Calculates real-time distance using the **Haversine Formula**:
    $$d = 2R \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \text{lat}}{2}\right) + \cos(\text{lat}_1)\cos(\text{lat}_2)\sin^2\left(\frac{\Delta \text{lon}}{2}\right)}\right)$$
  * Ranks available surplus food with **Nearest Messes First (Recommended)** so hot meals can be collected quickly!
  * Visual distance badges: `📍 0.6 km (Super Close!)`, `📍 1.8 km away`.
* **Live Freshness Countdown**:
  * Real-time urgency badges:
    * `⚡ Urgent! Fresh for 45 mins` (Pulsing badge)
    * `⏳ Fresh for 2h 15m`
    * `🌿 Fresh for 4h`
* **Interactive Map View**:
  * Integrated **Leaflet.js & OpenStreetMap** showing food pins and distances.
* **Themed UI Design**:
  * Custom styled dropdowns and controls matching the project's Emerald/Amber branding.
* **Instant Free Claim Flow**:
  * NGO specifies estimated arrival time (30 mins, 45 mins, 1 hour) and volunteer info.
  * Immediate access to Mess phone call link and Google Maps driving directions.
* **Pickup Tracker**:
  * View active pickups, history of completed meals collected, and option to cancel if vehicle is unavailable.

---

## 🛠️ Tech Stack

* **Backend**: Node.js, Express.js
* **Database**: SQLite (via `better-sqlite3` - zero setup, reliable, durable)
* **Authentication**: Session-based with `bcryptjs` password hashing
* **Geolocation & Reverse Geocoding**: Haversine distance calculations, HTML5 Geolocation API, OpenStreetMap Nominatim, Leaflet.js
* **Frontend UI**: Responsive Tailwind CSS, custom theme select dropdowns, custom urgency badges

---

## 🚀 Getting Started

### 1. Prerequisites
* Node.js (v18+ recommended)
* npm

### 2. Install Dependencies
```bash
npm install
```

### 3. Start the Application
```bash
npm start
```
Open your browser and navigate to: **[http://localhost:3000](http://localhost:3000)**

---

## 📁 Project Structure

```
d:\CEP\
├── server.js               # Express server, authentication & REST APIs
├── package.json            # Scripts & dependencies
├── README.md               # Documentation & setup guide
├── database/
│   ├── db.js               # SQLite setup, tables schema & Haversine distance
│   └── foodbridge.db       # SQLite database file
└── public/
    ├── index.html          # Landing page with live impact stats & food preview
    ├── auth.html           # Login & Registration with GPS autofill & interactive map
    ├── mess-portal.html    # Mess dashboard & surplus upload modal
    ├── ngo-portal.html     # NGO proximity feed, claim modal & map view
    ├── css/
    │   └── style.css       # Custom styling, themed dropdowns & urgency animations
    └── js/
        ├── common.js       # Shared utilities, reverse geocoding, session checks
        ├── mess.js         # Mess portal logic & lifecycle handling
        └── ngo.js          # NGO portal logic, proximity sorting & claims
```
