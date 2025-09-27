"use client";
import React from "react";
import Header from "../components/header/Header";
import Footer from "../components/footer/Footer";
import MapWrapper from "../components/map/MapWrapper";

export default function Home() {
  const [sideOpen, setSideOpen] = React.useState(false);

  return (
      <>
        <Header sideOpen={sideOpen} setSideOpen={setSideOpen} />
        <main>
          <MapWrapper onHamburger={() => setSideOpen(true)} />
        </main>
        <Footer />
      </>
  );
}