// Tramos del aspecto de la capital según su nivel (doc-1.8): cuanto más
// nivel, más dorada y con mejores animaciones (en el mapa y en el panel).
// Solo aspecto: la simulación no lo usa.

/** Tramos: nombre, colores del metal (claro, medio, oscuro) y su brillo. */
export const CAPITAL_TIERS = [
  { id: 'piedra', name: 'Piedra', from: 0, metal: ['#c9ccd2', '#8d929c', '#4f545e'], glow: 0, shine: false, sparks: 0, rays: false },
  { id: 'bronce', name: 'Bronce', from: 1, metal: ['#f0b47a', '#c27b3e', '#6e3f18'], glow: 0.18, shine: false, sparks: 0, rays: false },
  { id: 'plata', name: 'Plata', from: 3, metal: ['#ffffff', '#c3ccd8', '#6f7a8c'], glow: 0.28, shine: true, sparks: 0, rays: false },
  { id: 'oro', name: 'Oro', from: 6, metal: ['#fff3b0', '#f2b33d', '#8a5a10'], glow: 0.42, shine: true, sparks: 2, rays: false },
  { id: 'oro-real', name: 'Oro real', from: 9, metal: ['#fffbe0', '#ffc93c', '#9a6410'], glow: 0.58, shine: true, sparks: 4, rays: false },
  { id: 'leyenda', name: 'Ciudadela dorada', from: 12, metal: ['#ffffff', '#ffd75a', '#b07a12'], glow: 0.8, shine: true, sparks: 7, rays: true },
];

/** Índice del tramo de una capital de nivel `level` (0 a 5). */
export function capitalTier(level) {
  let t = 0;
  for (let i = 0; i < CAPITAL_TIERS.length; i++) if (level >= CAPITAL_TIERS[i].from) t = i;
  return t;
}
