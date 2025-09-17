// frontend/src/components/map/MapWrapper.tsx
"use client";

import React from "react";
import dynamic from "next/dynamic";

const Map = dynamic(() => import("./Map"), { ssr: false });

export default function MapWrapper() {

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100vw",
                height: "100vh",
                zIndex: 0,
            }}
        >
            <Map />
        </div>
    );
}