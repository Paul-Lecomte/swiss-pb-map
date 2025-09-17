// Header component
import React from 'react';

const Header = () => (
    <header
        className="w-full py-4 bg-gray-100 flex items-center justify-between px-8"
        style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            zIndex: 10,
        }}
    >
        <div className="text-xl font-bold">
            <a href="/">VotreLogo</a>
        </div>
        <nav className="flex gap-6">
            <a href="/features" className="hover:underline">Fonctionnalités</a>
            <a href="/pricing" className="hover:underline">Tarifs</a>
            <a href="/about" className="hover:underline">À propos</a>
        </nav>
        <div>
            <a href="/login" className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">Connexion</a>
        </div>
    </header>
);

export default Header;