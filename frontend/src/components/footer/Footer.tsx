import React from 'react';

const Footer = () => (
    <footer
        className="w-full text-center"
        style={{
            position: "fixed",
            color : "#000000",
            bottom: 0,
            left: 0,
            width: "100vw",
            zIndex: 10,
            height: "24px",
            /*
            background: "rgba(255,255,255,0.3)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            borderTop: "1px solid rgba(200,200,200,0.2)",
             */
            fontSize: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        }}
    >
        &copy; {new Date().getFullYear()} <a target="_blank" href="https://github.com/Paul-Lecomte">Lecomte Paul</a>
    </footer>
);

export default Footer;