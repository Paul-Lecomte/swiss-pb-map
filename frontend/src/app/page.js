"use client";
import Map from "../../components/Map";

export default function Home() {
  return (
      <div className="h-screen">
        <h1 className="text-center text-2xl font-bold p-4">Swiss Transit Map</h1>
        <Map />
      </div>
  );
}
