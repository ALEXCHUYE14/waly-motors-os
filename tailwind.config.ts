import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
      },
      colors: {
        // "Blanco Taller + Cobre" — sistema de diseño claro único (sin modo oscuro).
        fondo: "#F9F9F7", // fondo de página
        tarjeta: "#FFFFFF", // superficie de tarjetas / inputs
        borde: "#EAE7E1", // bordes sutiles de tarjetas / inputs
        grafito: "#201F1D", // texto principal — casi negro cálido, nunca gris plano
        cobre: "#C97B3D", // acento de marca — nav activo, botones secundarios, iconografía
        amarillo: "#FFC400", // reservado al CTA "Cobrar" y confirmaciones clave
        oxido: "#C4472B", // alerta / mora / peligro
        whatsapp: "#25D366", // verde oficial de marca — solo para el botón de WhatsApp
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(32 31 29 / 0.04), 0 1px 8px -2px rgb(32 31 29 / 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
