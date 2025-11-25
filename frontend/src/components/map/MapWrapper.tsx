"use client";

import React from "react";
import dynamic from "next/dynamic";
import { LayerState } from "../layer_option/LayerOption";

const Map = dynamic<{
    onHamburger: () => void;
    layersVisible: LayerState;
    setLayersVisible: React.Dispatch<React.SetStateAction<LayerState>>;
    optionPrefs?: { showRealtimeOverlay: boolean; showRouteProgress: boolean };
}>(() => import("./Map"), { ssr: false });

interface MapWrapperProps {
    onHamburger: () => void;
    layersVisible: LayerState;
    setLayersVisible: React.Dispatch<React.SetStateAction<LayerState>>;
    optionPrefs?: { showRealtimeOverlay: boolean; showRouteProgress: boolean };
}

export default function MapWrapper({ onHamburger, layersVisible, setLayersVisible, optionPrefs }: MapWrapperProps) {
    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100vw",
                height: "100vh",
            }}
        >
            <Map onHamburger={onHamburger} layersVisible={layersVisible} setLayersVisible={setLayersVisible} optionPrefs={optionPrefs} />
        </div>
    );
}