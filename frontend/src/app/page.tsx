"use client";
import React from "react";
import Header from "../components/header/Header";
import type { LayerState } from "../components/layer_option/LayerOption";
import Footer from "../components/footer/Footer";
import MapWrapper from "../components/map/MapWrapper";

const STORAGE_KEY = "swiss:layersVisible:v1";
const OPTION_PREFS_KEY = "swiss:optionPrefs:v1";

interface OptionPrefs {
  showRealtimeOverlay: boolean;
  showRouteProgress: boolean;
}

// Helper types for props casting
type HeaderPropsLocal = Parameters<typeof Header>[0];

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

  const [optionPrefs, setOptionPrefs] = React.useState<OptionPrefs>(() => {
    const defaults: OptionPrefs = { showRealtimeOverlay: false, showRouteProgress: false };
    try {
      if (typeof window === 'undefined') return defaults;
      const raw = localStorage.getItem(OPTION_PREFS_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed } as OptionPrefs;
    } catch { return defaults; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(OPTION_PREFS_KEY, JSON.stringify(optionPrefs)); } catch {}
  }, [optionPrefs]);

  return (
      <>
        <Header sideOpen={sideOpen} setSideOpen={setSideOpen} layersVisible={layersVisible} setLayersVisible={setLayersVisible} optionPrefs={optionPrefs} setOptionPrefs={setOptionPrefs} />
        <main>
          <MapWrapper onHamburger={() => setSideOpen(true)} layersVisible={layersVisible} setLayersVisible={setLayersVisible} optionPrefs={optionPrefs} />
        </main>
        <Footer />
      </>
  );
}