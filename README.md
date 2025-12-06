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
  <img alt="Tech Stack" src="https://img.shields.io/badge/Leaflet-199900?logo=openstreetmap&logoColor=white">
  <img alt="Tech Stack" src="https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white">
  <img alt="Tech Stack" src="https://img.shields.io/badge/typescript-003166?logo=typescript&logoColor=white">
  <img alt="Tech Stack" src="https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white">
  <img alt="License" src="https://img.shields.io/github/license/Paul-Lecomte/swiss-pb-map">
</p>

## What is SwissTransitMap?

SwissTransitMap is an interactive web app that visualizes the Swiss public transport network using GTFS data. It lets you explore stops, routes and timetables, see selected real‑time information, and plan journeys on a modern, intuitive map.

---

## Features

- Interactive map of the Swiss network (bus, train, tram, metro)
- GTFS data integration (stops, routes, trips, stop times)
- Basic real‑time updates (where available)
- Fast path search between two stops (server endpoint)
- Responsive UI with smooth map interactions

---
## Showcase video
gif to come when i record it for the final version

## Tech Stack

- Frontend: Next.js 15, React 19, React‑Leaflet, MUI, TypeScript
- Backend: Node.js, Express.js, Docker
- Database: MongoDB (primary store for GTFS and processed data)
- Data sources: Swiss GTFS, optional: OpenStreetMap/OpenMapTiles for basemaps

---

## Project Structure

```bash
swiss-pb-map/
├── backend/                        # Express API and data processing
│   ├── server.js                   # Server entry
│   ├── package.json                # Backend scripts (dev, update-gtfs, ...)
│   ├── .env                        # Backend configuration (see .env template below)
│   ├── config/
│   │   ├── corsOptions.js
│   │   └── dbConnection.js
│   ├── controller/
│   │   ├── algorithmController.js  # Fastest path orchestration
│   │   ├── routeController.js      # Routes/domain logic
│   │   ├── stopController.js       # Stops queries (bbox/search)
│   │   └── tripController.js       # Trips/GTFS endpoints
│   ├── middleware/
│   │   └── errorHandler.js
│   ├── model/                      # Mongoose schemas for GTFS entities
│   │   ├── agencyModel.js
│   │   ├── calendarDatesModel.js
│   │   ├── calendarModel.js
│   │   ├── feedInfoModel.js
│   │   ├── processedStopsModel.js
│   │   ├── routesModel.js
│   │   ├── stopsModel.js
│   │   ├── stopTimesModel.js
│   │   ├── transfersModel.js
│   │   └── tripsModel.js
│   ├── route/                      # API routes
│   │   ├── fastestRoute.js         # GET /api/fastest_path/:from_id/:to_id
│   │   ├── routeRoute.js           # /api/routes
│   │   ├── realtimeRoute.js        # /api/realtime
│   │   ├── stopRoute.js            # /api/stops
│   │   └── tripRoute.js            # /api/gtfs
│   ├── utils/                      # Data preparation helpers
│   │   └── gtfsDataUpdater.js      # Import/process GTFS (see scripts)
│   └── data/                       # Place GTFS here (see setup)
│       └── gtfs/                   # Raw GTFS files (e.g., stops.txt, trips.txt, ...)
├── frontend/                       # Next.js app
│   ├── package.json                # Frontend scripts (dev/build/start)
│   └── src/
│       ├── app/
│       │   ├── globals.css
│       │   ├── layout.tsx
│       │   └── page.tsx
│       ├── components/
│       │   ├── about/About.tsx
│       │   ├── map/Map.tsx
│       │   ├── map/MapWrapper.tsx
│       │   ├── option/Option.tsx
│       │   ├── routeinfopanel/RouteInfoPanel.tsx
│       │   ├── vehicle/Vehicle.tsx
│       │   ├── vehicle/VehiclesForRoute.tsx
│       │   └── ...
│       ├── services/
│       │   ├── RouteApiCalls.ts
│       │   └── StopsApiCalls.ts
│       └── workers/
│           └── routeStreamWorker.js
├── documentation/                  # Additional docs (if any)
├── LICENSE
└── README.md
```

---

## Prerequisites

- Node.js 18+ and npm
- MongoDB 6+ running locally (or a connection string to a remote instance)
- GTFS feed for Switzerland (official source)
- Optional: PostGIS (if you plan to use the experimental Postgres path)

---

## Pre-step: Generate enriched GTFS with pfaedle

Before running the built-in GTFS import scripts, generate the GTFS dataset using pfaedle with official Swiss sources:

- GTFS: CFF SBB FFS from https://opentransportdata.swiss/
- OSM: Most recent Switzerland extract from https://planet.osm.ch/

This step produces a GTFS feed that includes `shapes.txt` and other enhancements. After generation, you will place the output into `backend/data/gtfs/`.

Example commands:

Linux/macOS:

```
# Pull image
docker pull ghcr.io/ad-freiburg/pfaedle:latest

# Run pfaedle (adjust paths and filenames)
docker run -i --rm \
  --volume /path/to/osm/data:/osm \
  --volume /path/to/gtfs/data:/gtfs \
  --volume /path/to/output-dir:/gtfs-out \
  ghcr.io/ad-freiburg/pfaedle:latest \
  -x /osm/osm-data.xml.bz2 -i /gtfs/myfeed.zip
```

Windows (PowerShell, Docker Desktop):

```
# Pull image
docker pull ghcr.io/ad-freiburg/pfaedle:latest

# Run pfaedle (adjust paths and filenames)
docker run -i --rm \
  --volume "C:\\path\\to\\osm\\data":/osm \
  --volume "C:\\path\\to\\gtfs\\data":/gtfs \
  --volume "C:\\path\\to\\output-dir":/gtfs-out \
  ghcr.io/ad-freiburg/pfaedle:latest \
  -x /osm/osm-data.xml.bz2 -i /gtfs/myfeed.zip
```

Notes:
- Replace `/osm/osm-data.xml.bz2` with the actual OSM file inside `/osm` (e.g., `/osm/switzerland-latest.osm.pbf` or `/osm/switzerland.osm.bz2`, depending on what you downloaded).
- Replace `/gtfs/myfeed.zip` with the GTFS ZIP you downloaded from OpenTransport (`/gtfs/sbb_gtfs.zip`, etc.).
- The output GTFS (including `shapes.txt`) will be written into the mounted `/gtfs-out` directory on your machine.
- After generation, extract or copy the resulting GTFS files into `backend/data/gtfs/` before running the update scripts below.

---

## Configuration (.env)

Create `backend/.env` with the following keys (example names — do not commit secrets):

```
PORT=4000                  # Backend port (4000 recommended to avoid Next.js dev port)
NODE_ENV=development
DATABASE_URI=mongodb://localhost:27017/swissgtfsnetworkmap
JWT_SECRET=your-secret
GEOPS_API_KEY=your-geops-key           # optional
REALTIME_API_TOKEN=token-if-needed     # optional
# Optional Postgres (experimental)
PG_CONNECTION_STRING=postgresql://postgres:admin@localhost:5432/swisspbmap
PG_POOL_MAX=10
PG_SSL=false
```

---

## Setup

1) Clone the repository

```
git clone https://github.com/Paul-Lecomte/swiss-pb-map.git
cd swiss-pb-map
```

2) Install dependencies

```
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

3) Prepare GTFS data

- Download the Swiss GTFS feed and extract it into `backend/data/gtfs/` so files like `stops.txt`, `trips.txt`, `stop_times.txt` are present.
- Import/process data using the helper scripts:

```
# from backend/
npm run update-gtfs         # load base GTFS tables
npm run update-stops        # build processed stops
npm run update-routes       # build processed routes
npm run update-stoptimes    # build processed stop times
```

4) Run the app (two terminals)

```
# Terminal 1 → backend
cd backend
npm run dev          # or: node server.js

# Terminal 2 → frontend
cd frontend
npm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:4000 (if you set `PORT=4000`), otherwise adjust URLs used by the frontend services.

---

## API Overview (selected)

- GET `/api/stops/stops-in-bbox?minLat=..&minLon=..&maxLat=..&maxLon=..`
- GET `/api/stops/search-stops?q=lausanne`
- GET `/api/routes/...` (see `backend/route/routeRoute.js`)
- GET `/api/gtfs/...`   (see `backend/route/tripRoute.js`)
- GET `/api/realtime/...` (see `backend/route/realtimeRoute.js`)
- GET `/api/fastest_path/:from_id/:to_id?departure_time=HH:MM:SS`

Tip: Start the server and visit `http://localhost:4000/` for a small landing page and links.

---

## Development

- Frontend scripts
  - `npm run dev` — Next.js dev server (Turbopack)
  - `npm run build` — production build
  - `npm start` — start built app
- Backend scripts
  - `npm run dev` — start API with Nodemon
  - `npm run update-gtfs|update-stops|update-routes|update-stoptimes` — data processing

---

## Troubleshooting

- Port conflicts: Next.js dev uses 3000 by default. Run backend on 4000 (set `PORT=4000`), or start Next.js on another port (`npm run dev -- -p 3001`).
- MongoDB connection errors: ensure MongoDB is running and `DATABASE_URI` is correct.
- GTFS processing memory: scripts allocate larger heap (`--max-old-space-size=32768`). Reduce if your machine has less memory.

---

## Roadmap

- [x] Initial GTFS parsing and MongoDB storage
- [x] Stops clustering and map rendering
- [x] Real-time GTFS-RT ingestion (basic)
- [x] Routes and timetables listing endpoints
- [x] Link stops fully with routes and timetables in UI
- [x] Improved path search and UI integration
- [x] Advanced UI: real-time positions, disruptions
- [ ] User accounts & favorites not working on it rn
- [ ] Extend to other European networks

---

## Acknowledgements

- Official Swiss GTFS data providers
- OpenStreetMap & OpenMapTiles
- Leaflet.js / React‑Leaflet
- ad-freiburg for the GTFS processing pfaedle

---

## License

This project is open source. See the [LICENSE](./LICENSE) file for details.