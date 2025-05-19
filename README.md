# SwissTransitMap

![SwissTransitMap Banner](https://your-image-url.com/banner.png)

SwissTransitMap is an interactive web application that visualizes Switzerland's entire public transit network using GTFS data. The project aims to provide a real-time, user-friendly interface to explore transport routes, schedules, and connections across the country.

## 🚀 Features

- **Interactive Map**: Explore Switzerland's complete public transit network.
- **GTFS Data Integration**: Uses official GTFS data to display routes, stops, and schedules.
- **Multi-Mode Transport**: Supports buses, trains, metros, and trams.
- **Real-Time Updates**: Integrates live transit data for delays and service changes.
- **Route Planning**: Find the best public transport routes from point A to B.
- **Open-Source & Expandable**: Designed to be scalable and customizable.

## 🛠️ Tech Stack

- **Frontend**: React, NextJS, Tailwind CSS
- **Backend**: Node.js, Express.js
- **Database**: Local MongoDB (for GTFS data storage)
- **Mapping**: Leaflet.js + OpenStreetMap + OpenMapTiles
- **Data Processing**: GTFS Parser, RAPTOR Algorithm (for route planning waaaaaay after)
 
## 📦 Installation

1. **Clone the Repository**
   ```sh
   git clone https://github.com/Paul-Lecomte/SwissTransitMap.git
   cd SwissTransitMap
   ```

2. **Install Dependencies**
   ```sh
   # Backend
   cd backend
   npm install
   
   # Frontend
   cd ../frontend
   npm install
   ```

3. **Run the Application**
   ```sh
   # Start Backend Server
   cd backend
   npm start
   
   # Start Frontend Development Server
   cd ../frontend
   npm run dev
   ```

## 📊 Data Sources

- **GTFS Data**: Swiss public transport GTFS dataset (Fetched daily for updates)
- **OpenStreetMap**: For rendering maps
- **Swiss Transport API**: (Optional) Live transport data

## 📌 Roadmap

- [x] **Initial GTFS Data Parsing**
- [x] **Timetable making with a stop_id**
- [x] **Prepare the data to show the stops**
- [x] **Fetch all the stops to show them **
- [x] **Save the processed stops to mongodb**
- [x] **Update the stops with GTFSRT to have real time delays**
- [ ] **Basic Map with Routes and Stops**
- [ ] **Draw the routes between stops based on the roads**
- [ ] **UI developpement to show the timtable when clicking on a road**
- [ ] **Advanced map with realtime position**
- [ ] **Real-Time Data Integration**
- [ ] **Route Planning Implementation**
- [ ] **User Accounts & Custom Routes**
- [ ] **Expand to European Transit Networks**

## 🤝 Contributing

Contributions are welcome! If you'd like to improve the project, follow these steps:

1. Fork the repository.
2. Create a new branch: `git checkout -b feature-name`.
3. Commit your changes: `git commit -m 'Add feature'`.
4. Push to your branch: `git push origin feature-name`.
5. Submit a Pull Request.

## 📜 License

This project is open-source under the MIT License.

## 📧 Contact

- **Author**: Paul Lecomte
- **GitHub**: [Paul-Lecomte](https://github.com/Paul-Lecomte)

---

🚆 **SwissTransitMap – Making Swiss public transit more accessible and interactive!**

