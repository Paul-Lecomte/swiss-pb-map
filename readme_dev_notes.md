# SwissTransitMap - Development Notes

This README explains the recent updates, design decisions, and technical implementations made during the development of the SwissTransitMap project.

---

## Key Updates

### 1. Backend Refactoring
- **SwisTNE Helper Updates**: Rewrote `backend/utils/swisstneHelper.js` to:
  - Load large JSON files (`bn_edge.json`, `lut_base_type.json`) efficiently.
  - Filter features by `base_type` instead of keeping everything in memory.
  - Snap GTFS stops to nearest segments using Turf.js for optimized geometry building.
  - Avoid memory overflow issues with extremely large datasets.

- **Removed Node.js memory issues** by dynamically reading data instead of loading everything at once.

### 2. Dependency Management
- Replaced deprecated or missing packages:
  - Removed `geopackage` dependency that required `d3-queue`, which caused `MODULE_NOT_FOUND`.
  - Simplified external dependencies to avoid version conflicts and installation issues.

### 3. C++ Algorithm Integration
- Shortest path algorithm moved to `backend/fastest_path/` with proper Node.js binding.
- Backend routing now integrates seamlessly with MongoDB stored GTFS data.
- C++ code optimized for large networks, reducing runtime for route calculations.

### 4. Real-Time GTFS Integration
- Added support for GTFS-RT feeds in `backend/utils/gtfsRealTime.js`.
- Backend merges static GTFS schedules with real-time updates.
- Stops and trips reflect delays or disruptions in the frontend map.

### 5. Frontend Updates
- Next.js and React frontend remains modular:
  - `Map` component handles all Leaflet rendering.
  - Stops, routes, and timetables dynamically update from API.
  - UI is responsive, mobile-friendly, and uses Tailwind CSS.

### 6. Roadmap Progress
- Completed:
  - Initial GTFS parsing, MongoDB storage, and updates.
  - GTFS-RT integration.
  - Basic interactive map with stops.
- Next steps:
  - Display routes on the map.
  - Link stops to timetables.
  - Full route planning integration.
  - Advanced UI features: disruption warnings, real-time positions.

---

## How We Did It

1. **Data Handling:**
   - Read GTFS data from zip files, parse, and store in MongoDB.
   - Build geometries using Turf.js for accurate map snapping.

2. **Backend Logic:**
   - Node.js + Express API serves stops, routes, and trips.
   - C++ module computes shortest paths efficiently.

3. **Frontend Integration:**
   - Next.js + React with modular components.
   - Map layers, search, and route info panel fully reactive.

4. **Error Handling & Logging:**
   - Middleware in Express handles API errors.
   - Logs meaningful messages for debugging.

---

## Notes for Developers

- Keep `bn_edge.json` and `lut_base_type.json` manageable; consider splitting for extremely large networks.
- All new utilities should follow modular patterns in `backend/utils/`.
- Frontend components in `src/components/` must remain reusable and isolated.
- C++ routing code should be updated cautiously; binding errors can crash the backend.

---

This document serves as a living reference for understanding the structure, updates, and reasoning behind the current SwissTransitMap implementation.

