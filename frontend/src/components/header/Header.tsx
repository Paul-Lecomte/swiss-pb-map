"use client";
import React, { useRef } from "react";
import SideMenu from "../../components/side_menu/SideMenu";
import LayerOption, { LayerState } from "../../components/layer_option/LayerOption";
import Station from "../../components/station/Station";
import Option from "../../components/option/Option";
import About from "../../components/about/About";
import "./Header.css";

type Props = {
    sideOpen: boolean;
    setSideOpen: (open: boolean) => void;
    layersVisible: LayerState;
    setLayersVisible: React.Dispatch<React.SetStateAction<LayerState>>;
};

const Header = ({ sideOpen, setSideOpen, layersVisible, setLayersVisible }: Props) => {
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

    React.useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            if (
                (sideMenuRef.current && sideMenuRef.current.contains(target)) ||
                (layerRef.current && layerRef.current.contains(target)) ||
                (stationRef.current && stationRef.current.contains(target)) ||
                (optionRef.current && optionRef.current.contains(target)) ||
                (aboutRef.current && aboutRef.current.contains(target))
            ) return;

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
    }, [setSideOpen]);

    return (
        <header className="header">
            {/* Side menu */}
            {sideOpen && (
                <div ref={sideMenuRef} className="header-popup side">
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

            {/* Layer option panel */}
            {layerOpen && (
                <div ref={layerRef} className="header-popup layer">
                    <LayerOption
                        onClose={() => setLayerOpen(false)}
                        state={layersVisible}
                        onChange={(key, value) =>
                            setLayersVisible(prev => ({ ...prev, [key]: value }))
                        }
                    />
                </div>
            )}

            {/* Station panel */}
            {stationOpen && (
                <div ref={stationRef} className="header-popup station">
                    <Station onClose={() => setStationOpen(false)} />
                </div>
            )}

            {/* Option panel */}
            {optionOpen && (
                <div ref={optionRef} className="header-popup option">
                    <Option onClose={() => setOptionOpen(false)} />
                </div>
            )}

            {/* About panel */}
            {aboutOpen && (
                <div ref={aboutRef} className="header-popup about">
                    <About onClose={() => setAboutOpen(false)} />
                </div>
            )}
        </header>
    );
};

export default Header;