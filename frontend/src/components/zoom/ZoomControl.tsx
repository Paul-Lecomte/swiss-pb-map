"use client";

import L from "leaflet";
import { createControlComponent } from "@react-leaflet/core";
import "./ZoomControl.css";

const ZoomControlLeaflet = L.Control.extend({
  options: {
    position: "topright",
  },

  onAdd: function (map: any) {
    const container = L.DomUtil.create("div", "zoom-control");

    // Prevent map from moving when clicking on the control
    L.DomEvent.disableClickPropagation(container);

    // Zoom-in button
    const zoomInBtn = L.DomUtil.create("button", "", container);
    zoomInBtn.innerHTML = "+";
    zoomInBtn.onclick = () => map.zoomIn();

    // Zoom slider
    const slider = L.DomUtil.create("input", "zoom-slider", container) as HTMLInputElement;
    slider.type = "range";
    slider.min = map.getMinZoom().toString();
    slider.max = map.getMaxZoom().toString();
    slider.value = map.getZoom().toString();
    slider.oninput = (e: any) => map.setZoom(Number(e.target.value));

    // Keep the slider value synced with the current zoom level
    map.on("zoomend", () => {
      slider.value = map.getZoom().toString();
    });

    // Zoom-out button
    const zoomOutBtn = L.DomUtil.create("button", "", container);
    zoomOutBtn.innerHTML = "−";
    zoomOutBtn.onclick = () => map.zoomOut();

    // Recenter button (user location)
    const centerBtn = L.DomUtil.create("button", "", container);
    centerBtn.innerHTML = "●";
    centerBtn.title = "Recenter on your location";

    let userCoords: [number, number] | null = null;

    // Try to get user's geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
          (pos) => {
            userCoords = [pos.coords.latitude, pos.coords.longitude];
          },
          (err) => {
            console.warn("Geolocation error:", err.message);
          }
      );
    }

    // Recenter map on user's position when the button is clicked
    centerBtn.onclick = () => {
      if (userCoords) {
        map.setView(userCoords, 15); // zoom level 15 = close view
      } else {
        alert("User location not available");
      }
    };

    return container;
  },
});

// Convert to React component
const ZoomControl = createControlComponent(
    (props: any) => new ZoomControlLeaflet(props) as any
);

export default ZoomControl;