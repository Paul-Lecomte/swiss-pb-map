<!-- PROJECT TITLE & BADGES -->
<p align="center">
  <img src="./frontend/public/swisstransitmap_logo.png" alt="SwissTransitMap Logo" width="120" />
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
- **Backend**: Node.js, Express.js, C++ 23 (shortest path algorithm)
- **Database**: MongoDB (GTFS storage)
- **Data**: Swiss GTFS, OpenMapTiles, Swiss Transport API (optional)

---

## Project Structure

```bash
SwissTransitMap/
├── backend/                        # Backend server and API logic
│   ├── server.js                   # Main Node.js server entry point
│   ├── package.json                # Backend dependencies and scripts
│   ├── gtfs-realtime-data.bin      # Cached GTFS real-time data
│   ├── config/                     # Configuration files (DB, CORS, etc.)
│   │   ├── allowedOrigins.js       # Allowed CORS origins
│   │   ├── corsOptions.js          # CORS options
│   │   └── dbConnection.js         # MongoDB connection setup
│   ├── controller/                 # Node.js business logic
│   │   ├── algorithmController.js  # Route calculation logic
│   │   ├── stopController.js       # Stop-related logic
│   │   └── tripController.js       # Trip-related logic
│   ├── data/                       # Static and processed data files
│   │   └── stoptimes.json          # Timetable data
│   ├── fastest_path/               # C++ shortest path algorithm
│   │
│   ├── middleware/                 # Express middlewares
│   │   └── errorHandler.js         # Error handling middleware
│   ├── model/                      # Mongoose models (stops, trips, etc.)
│   │   ├── agencyModel.js          # Agency schema
│   │   ├── calendarDatesModel.js   # Calendar dates schema
│   │   ├── calendarModel.js        # Calendar schema
│   │   ├── feedInfoModel.js        # Feed info schema
│   │   ├── processedStopsModel.js  # Processed stops schema
│   │   ├── routesModel.js          # Routes schema
│   │   ├── stopsModel.js           # Stops schema
│   │   ├── stopTimesModel.js       # Stop times schema
│   │   ├── transfersModel.js       # Transfers schema
│   │   └── tripsModel.js           # Trips schema
│   ├── route/                      # Express API routes
│   │   ├── fastestRoute.js         # Fastest route API
│   │   └── tripRoute.js            # Trip API
│   ├── utils/                      # GTFS & real-time utilities
│   │   ├── exportStoptimes.js      # Export timetable data
│   │   ├── gtfsDataUpdater.js      # GTFS data update logic
│   │   ├── gtfsRealTime.js         # GTFS real-time integration
│   │   └── validateJson.py         # JSON validation script
├── frontend/                       # Next.js/React frontend application
│   ├── eslint.config.mjs           # ESLint configuration for code linting
│   ├── next-env.d.ts               # Next.js type declarations for TypeScript
│   ├── next.config.ts              # Main Next.js configuration
│   ├── package.json                # Frontend dependencies and scripts
│   ├── postcss.config.mjs          # PostCSS configuration (e.g., Tailwind CSS)
│   ├── README.md                   # Frontend documentation
│   ├── tsconfig.json               # TypeScript configuration
│   ├── public/                     # Static files accessible by the browser
│   │   ├── file.svg                # Icon/illustration
│   │   ├── globe.svg               # Icon/illustration
│   │   ├── img.png                 # Image
│   │   ├── next.svg                # Next.js logo
│   │   ├── swisstransitmap_logo.png# Project logo
│   │   ├── vercel.svg              # Vercel logo
│   │   └── window.svg              # Icon/illustration
│   └── src/
│       ├── app/                    # Structure and global styles
│       │   ├── favicon.ico         # Site icon
│       │   ├── globals.css         # Global styles
│       │   ├── layout.tsx          # Main application layout
│       │   └── page.tsx            # Home page
│       ├── components/             # Reusable React components
│       │   ├── about/
│       │   │   └── About.tsx       # "About" section
│       │   ├── footer/
│       │   │   └── Footer.tsx      # Footer
│       │   ├── header/
│       │   │   ├── Header.css      # Header styles
│       │   │   └── Header.tsx      # Site header
│       │   ├── layer_option/
│       │   │   └── LayerOption.tsx # Map layer options
│       │   ├── map/
│       │   │   ├── Map.tsx         # Interactive Leaflet map
│       │   │   └── MapWrapper.tsx  # Map wrapper
│       │   ├── option/
│       │   │   └── Option.tsx      # Miscellaneous options component
│       │   ├── search/
│       │   │   ├── Search.css      # Search bar styles
│       │   │   └── Search.tsx      # Search bar
│       │   ├── side_menu/
│       │   │   └── SideMenu.tsx    # Side menu
│       │   ├── station/
│       │   │   └── Station.tsx     # Station display
│       │   ├── routeinfopanel/
│       │   │   └── RouteInfoPanel.tsx # Transport information
│       │   └── zoom/
│       │       ├── ZoomControl.css # Zoom control styles
│       │       └── ZoomControl.tsx # Map zoom control
│       └── services/
│           └── StopsApiCalls.ts    # API calls for stops
├── public/                         # Static assets (images, favicon)
├── README.md                       # Project documentation
└── LICENSE                         # Project license
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
- [x] Implementation of stable openmaptile generation
- [ ] Just showing stops on map bz clusters based on the camera position and zoom level
- [ ] Interactive map with routes and stops
- [ ] Link stops with routes and timetables
- [ ] Optimal route planning (C++ algorithm)
- [ ] Advanced UI: timetables, disruptions, real-time positions
- [ ] User accounts & favorites
- [ ] Extend to other European networks

---

## Acknowledgements

- Official Swiss GTFS data
- OpenStreetMap & OpenMapTiles
- Leaflet.js for mapping

---

## License

This project is licensed under the terms of the GNU General Public License v3.0.  
Copyright (c) 2025 Paul Lecomte.

See the [LICENSE](./LICENSE) file for details.