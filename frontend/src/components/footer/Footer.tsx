import React from 'react';

const Footer = () => (
    <footer className="w-full py-4 bg-gray-100 text-center">
        <div className="flex justify-center gap-6 mb-2">
            <a href="/about" className="hover:underline">À propos</a>
            <a href="/contact" className="hover:underline">Contact</a>
            <a href="/privacy" className="hover:underline">Confidentialité</a>
        </div>
        <div className="text-sm text-gray-500">
            &copy; {new Date().getFullYear()} Votre Société. Tous droits réservés.
        </div>
    </footer>
);

export default Footer;