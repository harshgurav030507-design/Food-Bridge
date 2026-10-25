# FoodBridge

A web platform that connects college canteens and local messes 
with nearby NGOs and orphanages to reduce food waste.

**Live site:** https://food-bridge-h1tp.onrender.com

---

## What it does

Messes post their leftover food with a quantity and an expiry time.
NGOs browse available food sorted by distance, claim what they need, 
and coordinate pickup directly with the mess.

---

## Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL (hosted on Neon)
- **Frontend:** HTML, CSS, JavaScript, Tailwind CSS
- **Maps:** Leaflet.js + OpenStreetMap
- **Auth:** Session-based login with bcrypt password hashing
- **Email OTP:** Brevo (for registration verification)
- **Deployment:** Render

---

## Features

- Email OTP verification on registration
- Distance-based food sorting using the Haversine formula
- Live freshness countdown on food listings
- Mess and NGO dashboards with claim tracking
- Interactive map showing nearby available food

---

## Running locally

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in the values
3. Run `npm install`
4. Run `npm start`
5. Open `http://localhost:3000`

---

## Project structure

```
├── server.js          # Express server and API routes
├── mailer.js          # Email sending via Brevo / Gmail
├── database/
│   └── db.js          # Postgres setup and table definitions
└── public/
    ├── index.html     # Landing page
    ├── auth.html      # Login and registration
    ├── mess-portal.html
    ├── ngo-portal.html
    ├── css/
    └── js/
```