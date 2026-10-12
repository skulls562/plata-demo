import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Carpeta de compilación configurable: el desarrollo del panel usa otra para no pisar al servidor en producción.
  distDir: process.env.PLATA_DIST_DIR || ".next",
  cacheComponents: true,
  // El botón «N» del modo desarrollo tapa la primera pestaña de la barra del celular y estorba a las pruebas e2e.
  devIndicators: false,
  partialPrefetching: true,
  // Seguridad (SPEC §7.7, §7.10): sin X-Powered-By y búfer del proxy acotado (por defecto 10 MB).
  poweredByHeader: false,
  experimental: {
    proxyClientMaxBodySize: "512kb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
