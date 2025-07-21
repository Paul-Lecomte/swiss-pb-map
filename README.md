<!-- PROJECT TITLE & BADGES -->
<p align="center">
  <img src="https://your-image-url.com/banner.png" alt="SwissTransitMap Logo" width="120" />
</p>
<h1 align="center">SwissTransitMap</h1>
<p align="center">
  <strong>Swiss public transport network visualization & route planning</strong><br>
  <a href="https://github.com/Paul-Lecomte/swiss-pb-map/stargazers">
    <img alt="GitHub stars" src="https://img.shields.io/github/stars/Paul-Lecomte/swiss-pb-map?style=social">
  </a>
  <img alt="Tech Stack" src="https://img.shields.io/badge/Next.js-000?logo=nextdotjs&logoColor=white&label=Next.js">
  <img alt="Tech Stack" src="https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=white">
  <img alt="Tech Stack" src="https://img.shields.io/badge/Tailwind_CSS-38bdf8?logo=tailwindcss&logoColor=white">
  <img alt="Tech Stack" src="https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white">
  <img alt="Tech Stack" src="https://img.shields.io/badge/C++-00599C?logo=c%2b%2b&logoColor=white">
  <img alt="Tech Stack" src="https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white">
  <img alt="License: GPL v3" src="https://img.shields.io/badge/License-GPLv3-blue.svg">
</p>



## What is SwissTransitMap?

**SwissTransitMap** is an interactive web app that visualizes the Swiss public transport network using GTFS data. It lets you explore stops, timetables, routes, and plan journeys in real time on a modern, intuitive map.

<p align="center">
  <img src="https://your-image-url.com/example-map.png" alt="SwissTransitMap Example Map" width="400" />
</p>

---

## Features

- Interactive map of the Swiss network (bus, train, tram, metro)
- Full GTFS data integration (stops, timetables, routes)
- Real-time updates (delays, disruptions)
- Optimal route planning between any two stops
- Modern, responsive, open-source UI

---

## Tech Stack

- **Frontend**: React, Next.js, Tailwind CSS, Leaflet.js, OpenStreetMap
- **Backend**: Node.js, Express.js, Rust (shortest path algorithm)
- **Database**: MongoDB (GTFS storage)
- **Data**: Swiss GTFS, OpenMapTiles, Swiss Transport API (optional)

---

## Project Structure

```bash
SwissTransitMap/
├── backend/
│   ├── server.js
│   ├── package.json
│   ├── fastest_path/           # Rust (Cargo) – optimal route calculation
│   │   ├── Cargo.toml
│   │   └── src/
│   ├── model/                  # Mongoose models (stops, trips, etc.)
│   ├── controller/             # Node.js business logic
│   ├── route/                  # Express API routes
│   ├── utils/                  # GTFS & real-time tools
│   └── middleware/             # Express middlewares
├── frontend/                   # (see Next.js/React structure)
├── public/                     # Static assets (images, favicon)
├── README.md
└── LICENSE
```

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Paul-Lecomte/SwissTransitMap.git
cd SwissTransitMap
```

### 2. Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 3. Run the application

```bash
# Start the backend
cd backend
npm start

# Start the frontend
cd ../frontend
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Usage

- Explore the map to view stops, lines, and timetables.
- Search for the optimal route between two stops.
- Check real-time schedules and disruptions.

---

## Customization

- Modify models or logic in `backend/model/` and `backend/controller/`.
- Add new features in the frontend (React/Next.js).
- Extend the Rust algorithm in `backend/fastest_path/` for other calculation modes.

---

## Roadmap

- [x] Initial GTFS data parsing
- [x] Timetable by stop_id
- [x] MongoDB save & update
- [x] Real-time GTFSRT integration
- [ ] Interactive map with routes and stops
- [ ] Optimal route planning (Rust)
- [ ] Advanced UI: timetables, disruptions, real-time positions
- [ ] User accounts & favorites
- [ ] Extend to other European networks

---

## Acknowledgements

- Official Swiss GTFS data
- OpenStreetMap & OpenMapTiles
- Leaflet.js for mapping
- [kortix-ai/suna](https://github.com/kortix-ai/suna) for README inspiration

---

## License

This project is licensed under the terms of the GNU General Public License v3.0.  
Copyright (c) 2025 Paul Lecomte.

See the [LICENSE](./LICENSE) file for details.