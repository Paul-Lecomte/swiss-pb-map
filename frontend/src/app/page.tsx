"use client";
import React from "react";
import Header from "../components/header/Header";
import Footer from "../components/footer/Footer";
import MapWrapper from "../components/map/MapWrapper";
import { LayerState } from "../components/layer_option/LayerOption";

const STORAGE_KEY = "swiss:layersVisible:v1";

export default function Home() {
  const [sideOpen, setSideOpen] = React.useState(false);

  const defaultState: LayerState = {
    railway: true,
    stations: true,
    tram: true,
    bus: true,
    trolleybus: true,
    ferry: true,
    backgroundPois: true,
    showRoutes: true,
    showVehicles: true,
  };

  const [layersVisible, setLayersVisible] = React.useState<LayerState>(() => {
    try {
      if (typeof window === "undefined") return defaultState;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState;
      const parsed = JSON.parse(raw);
      return { ...defaultState, ...parsed } as LayerState;
    } catch (e) {
      console.warn("Failed to read layersVisible from localStorage", e);
      return defaultState;
    }
  });

  // Persist changes
  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layersVisible));
    } catch (e) {
      console.warn("Failed to save layersVisible to localStorage", e);
    }
  }, [layersVisible]);

  return (
      <>
        <Header sideOpen={sideOpen} setSideOpen={setSideOpen} layersVisible={layersVisible} setLayersVisible={setLayersVisible} />
        <main>
          <MapWrapper onHamburger={() => setSideOpen(true)} layersVisible={layersVisible} setLayersVisible={setLayersVisible} />
        </main>
        <Footer />
      </>
  );
}