import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "media",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
      },
      colors: {
        amarillo: "#FFC400", // marca / acción primaria
        oxido: "#C4472B", // alerta / mora / peligro
        asfalto: "#17181C", // superficie oscura (tarjetas, sidebar, inputs)
        noche: "#101114", // fondo de página en modo oscuro (un nivel bajo asfalto)
        hueso: "#F7F5F0", // superficie clara
        whatsapp: "#25D366", // verde oficial de marca — solo para el botón de WhatsApp
      },
    },
  },
  plugins: [],
};

export default config;
