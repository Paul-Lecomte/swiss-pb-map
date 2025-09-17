import React from 'react';

const Header = () => (
    <header
        className="w-full flex items-center justify-between px-4"
        style={{
            position: "fixed",
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
    >
        <a href="/" className="text-base font-bold">VotreLogo</a>
        <nav className="flex gap-4 text-xs">
            <a href="/features" className="hover:underline">Fonctionnalités</a>
            <a href="/about" className="hover:underline">À propos</a>
        </nav>
    </header>
);

export default Header;