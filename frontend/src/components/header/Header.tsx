"use client";
import React from 'react';
import TransportInfo from "@/components/transport_info/TransportInfo";
import Search from "../../components/search/Search";
import SideMenu from "../../components/side_menu/SideMenu";
import LayerOption from "../../components/layer_option/LayerOption";
import Zoom from "../../components/zoom/Zoom";

const Header = () => {

    const [sideOpen, setSideOpen] = React.useState(false);
    const [layerOpen, setLayerOpen] = React.useState(false);

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
            <a href="/" className="text-base font-bold">VotreLogo</a>
            <nav className="flex gap-4 text-xs">
                <a href="/features" className="hover:underline">Fonctionnalités</a>
                <a href="/about" className="hover:underline">À propos</a>
            </nav>
            {/* Top search bar overlay */}
            <div
                style={{
                    position: "absolute",
                    top: 12,
                    left: "50%",
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
                    style={{
                        position: "absolute",
                        top: 56,
                        left: 16,
                        zIndex: 30,
                    }}
                >
                    <SideMenu
                        onClose={() => setSideOpen(false)}
                        onLayerOption={() => setLayerOpen((v) => !v)}
                    />
                </div>
            )}

            {/* Layer options popup */}
            {layerOpen && (
                <div
                    style={{
                        position: "absolute",
                        top: 56,
                        left: 84,
                        zIndex: 25,
                    }}
                >
                    <LayerOption onClose={() => setLayerOpen(false)} />
                </div>
            )}

            {/* Right-side zoom control (visual) */}
            <div
                style={{
                    position: "absolute",
                    right: 12,
                    top: 80,
                    zIndex: 20,
                }}
            >
                <Zoom />
            </div>
        </header>
    )
};

export default Header;