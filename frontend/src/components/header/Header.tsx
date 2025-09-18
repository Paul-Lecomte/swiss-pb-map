"use client";
import React, { useRef } from 'react';
import TransportInfo from "@/components/transport_info/TransportInfo";
import Search from "../../components/search/Search";
import SideMenu from "../../components/side_menu/SideMenu";
import LayerOption from "../../components/layer_option/LayerOption";
import Station from "../../components/station/Station";
import Option from "../../components/option/Option";
import About from "../../components/about/About";

const Header = () => {

    const [sideOpen, setSideOpen] = React.useState(false);
    const [layerOpen, setLayerOpen] = React.useState(false);
    const [stationOpen, setStationOpen] = React.useState(false);
    const [optionOpen, setOptionOpen] = React.useState(false);
    const [aboutOpen, setAboutOpen] = React.useState(false);

    // Refs for detecting clicks outside
    const sideMenuRef = useRef<HTMLDivElement>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const stationRef = useRef<HTMLDivElement>(null);
    const optionRef = useRef<HTMLDivElement>(null);
    const aboutRef = useRef<HTMLDivElement>(null);

    // Close side menu when clicking outside
    React.useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            if (
                (sideMenuRef.current && sideMenuRef.current.contains(target)) ||
                (layerRef.current && layerRef.current.contains(target)) ||
                (stationRef.current && stationRef.current.contains(target)) ||
                (optionRef.current && optionRef.current.contains(target)) ||
                (aboutRef.current && aboutRef.current.contains(target))
            ) {
                return; // On clique à l'intérieur d'un menu/popup
            }
            setSideOpen(false);
            setLayerOpen(false);
            setStationOpen(false);
            setOptionOpen(false);
            setAboutOpen(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    return (
        <header
            className="w-full flex items-center justify-between px-4"
            /*
            style={{
                position: "fixed",
                color : "#000000",
                top: 0,
                left: 0,
                width: "100vw",
                zIndex: 10,
                height: "32px",
                background: "rgba(255,255,255,0.3)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                borderBottom: "1px solid rgba(200,200,200,0.2)",
            }}
             */
        >
            {/* Top search bar overlay */}
            <div
                style={{
                    position: "absolute",
                    top: 12,
                    left: "35%",
                    transform: "translateX(-50%)",
                    zIndex: 20,
                    width: "min(760px, 90vw)",
                }}
            >
                <Search
                    onHamburger={() => setSideOpen((v) => !v)}
                />
            </div>

            {/* Popup side menu near top-left of search */}
            {sideOpen && (
                <div
                    ref={sideMenuRef}
                    style={{
                        position: "absolute",
                        top: 70,
                        left: 16,
                        zIndex: 30,
                    }}
                >
                    <SideMenu
                        onClose={() => {
                            setSideOpen(false);
                            setLayerOpen(false);
                            setStationOpen(false);
                            setOptionOpen(false);
                            setAboutOpen(false);
                        }}
                        onLayerOption={() => {
                            setLayerOpen(true);
                            setStationOpen(false);
                            setOptionOpen(false);
                            setAboutOpen(false);
                        }}
                        onStation={() => {
                            setLayerOpen(false);
                            setStationOpen(true);
                            setOptionOpen(false);
                            setAboutOpen(false);
                        }}
                        onOption={() => {
                            setLayerOpen(false);
                            setStationOpen(false);
                            setOptionOpen(true);
                            setAboutOpen(false);
                        }}
                        onAbout={() => {
                            setLayerOpen(false);
                            setStationOpen(false);
                            setOptionOpen(false);
                            setAboutOpen(true);
                        }}
                    />
                </div>
            )}

            {/* Layer options popup */}
            {layerOpen && (
                <div
                    ref={layerRef}
                    style={{
                        position: "absolute",
                        top: 104,
                        left: 180,
                        zIndex: 25,
                    }}
                >
                    <LayerOption onClose={() => setLayerOpen(false)} />
                </div>
            )}

            {/* Stations popup */}
            {stationOpen && (
                <div
                    ref={stationRef}
                    style={{
                        position: "absolute",
                        top: 136,
                        left: 180,
                        zIndex: 25,
                    }}
                >
                    <Station onClose={() => setStationOpen(false)} />
                </div>
            )}

            {/* Options popup */}
            {optionOpen && (
                <div
                    ref={optionRef}
                    style={{
                        position: "absolute",
                        top: 170,
                        left: 180,
                        zIndex: 25,
                    }}
                >
                    <Option onClose={() => setOptionOpen(false)} />
                </div>
            )}

            {/* À propos popup */}
            {aboutOpen && (
                <div
                    ref={aboutRef}
                    style={{
                        position: "absolute",
                        top: 205,
                        left: 180,
                        zIndex: 25,
                    }}
                >
                    <About onClose={() => setAboutOpen(false)} />
                </div>
            )}
        </header>
    )
};

export default Header;