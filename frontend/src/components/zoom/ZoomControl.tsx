"use client";

import L from "leaflet";
import { useEffect, useState } from "react";
import { createControlComponent } from "@react-leaflet/core";
import "./ZoomControl.css";

const ZoomControlLeaflet = L.Control.extend({
  options: {
    position: "topright", // comme les contrôles natifs
  },

  onAdd: function (map: L.Map) {
    const container = L.DomUtil.create("div", "zoom-control");

    // Empêche la map de bouger quand on clique sur le contrôle
    L.DomEvent.disableClickPropagation(container);

    // Bouton +
    const zoomInBtn = L.DomUtil.create("button", "", container);
    zoomInBtn.innerHTML = "+";
    zoomInBtn.onclick = () => map.zoomIn();

    // Slider
    const slider = L.DomUtil.create("input", "zoom-slider", container) as HTMLInputElement;
    slider.type = "range";
    slider.min = map.getMinZoom().toString();
    slider.max = map.getMaxZoom().toString();
    slider.value = map.getZoom().toString();
    slider.oninput = (e: any) => map.setZoom(Number(e.target.value));

    // Sync avec le zoom de la map
    map.on("zoomend", () => {
      slider.value = map.getZoom().toString();
    });

    // Bouton -
    const zoomOutBtn = L.DomUtil.create("button", "", container);
    zoomOutBtn.innerHTML = "−";
    zoomOutBtn.onclick = () => map.zoomOut();

    // Bouton recentrage
    const centerBtn = L.DomUtil.create("button", "", container);
    centerBtn.innerHTML = "●";
    centerBtn.onclick = () => map.setView([46.516, 6.63282], 13);

    return container;
  },
});

// Convertit en composant React
const ZoomControl = createControlComponent((props) => new ZoomControlLeaflet(props));

export default ZoomControl;