import type { MetadataRoute } from 'next';
import { COLOR_FONDO } from './tema';

// Para instalar el panel en el celular (Añadir a pantalla de inicio). Solo trae nombre, colores e íconos: nada de datos.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Plata',
    short_name: 'Plata',
    description: 'Tu plata, clara: cuánto puedes gastar hoy y por qué.',
    lang: 'es-CO',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: COLOR_FONDO,
    theme_color: COLOR_FONDO,
    id: '/',
    shortcuts: [
      { name: 'Inicio', short_name: 'Inicio', url: '/', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Deudas y saldos', short_name: 'Deudas', url: '/deudas', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Simulador', short_name: 'Simulador', url: '/simulador', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
