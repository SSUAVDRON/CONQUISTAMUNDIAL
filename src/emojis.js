// Emojis de partida: se mandan durante la partida (a todos, con el botón de
// la barra de arriba, o a una nación, desde su ficha) y salen en un globo
// sobre tu nación; también en línea. Los diez de siempre vienen de serie;
// otros se ganan subiendo de nivel o con gestas, o se compran en la tienda.
// La IA también los usa: contesta y reacciona a lo que pasa en la partida.

/** Colección: { id, e (el emoji), name, unlock } (unlock como el resto de la tienda). */
export const EMOJI_ITEMS = [
  // De serie
  { id: 'bien', e: '👍', name: 'Bien', unlock: null },
  { id: 'mal', e: '👎', name: 'Mal', unlock: null },
  { id: 'trato', e: '🤝', name: 'Trato', unlock: null },
  { id: 'enfado', e: '😠', name: 'Enfado', unlock: null },
  { id: 'risa', e: '😂', name: 'Risa', unlock: null },
  { id: 'pena', e: '😢', name: 'Pena', unlock: null },
  { id: 'fuego', e: '🔥', name: 'Fuego', unlock: null },
  { id: 'espadas', e: '⚔️', name: 'A la guerra', unlock: null },
  { id: 'rendicion', e: '🏳️', name: 'Me rindo', unlock: null },
  { id: 'corazon', e: '❤️', name: 'Corazón', unlock: null },
  // Subiendo de nivel
  { id: 'saludo', e: '👋', name: 'Saludo', unlock: { level: 2 } },
  { id: 'chulo', e: '😎', name: 'Chulería', unlock: { level: 4 } },
  { id: 'pensar', e: '🤔', name: 'Pensativo', unlock: { level: 6 } },
  { id: 'susto', e: '😱', name: 'Susto', unlock: { level: 8 } },
  { id: 'calavera', e: '💀', name: 'Calavera', unlock: { level: 10 } },
  // Con gestas
  { id: 'corona', e: '👑', name: 'Corona', unlock: { ach: 'primera_victoria' } },
  { id: 'trofeo', e: '🏆', name: 'Trofeo', unlock: { ach: 'gran_victoria' } },
  { id: 'paloma', e: '🕊️', name: 'Paloma de la paz', unlock: { ach: 'diplomatico' } },
  { id: 'ancla', e: '⚓', name: 'Ancla', unlock: { ach: 'marino' } },
  { id: 'hacha', e: '🪓', name: 'Hacha', unlock: { ach: 'verdugo' } },
  // En la tienda
  { id: 'diablillo', e: '😈', name: 'Diablillo', unlock: { price: 150 } },
  { id: 'palomitas', e: '🍿', name: 'Palomitas', unlock: { price: 150 } },
  { id: 'firmes', e: '🫡', name: 'A sus órdenes', unlock: { price: 150 } },
  { id: 'payaso', e: '🤡', name: 'Payaso', unlock: { price: 150 } },
  { id: 'rayo', e: '⚡', name: 'Rayo', unlock: { price: 150 } },
  { id: 'fiesta', e: '🎉', name: 'Fiesta', unlock: { price: 200 } },
  { id: 'castillo', e: '🏰', name: 'Castillo', unlock: { price: 200 } },
  { id: 'bomba', e: '💣', name: 'Bomba', unlock: { price: 200 } },
  { id: 'dinero', e: '💸', name: 'Lluvia de oro', unlock: { price: 200 } },
  { id: 'cohete', e: '🚀', name: 'Cohete', unlock: { price: 250 } },
  { id: 'volcan', e: '🌋', name: 'Volcán', unlock: { price: 250 } },
  { id: 'cerebro', e: '🧠', name: 'Estratega', unlock: { price: 300 } },
  { id: 'dragon', e: '🐉', name: 'Dragón', unlock: { price: 300 } },
  { id: 'pirata', e: '🏴‍☠️', name: 'Pirata', unlock: { price: 300 } },
];

/** Todos los emojis que acepta la partida (los de cualquiera, también en línea). */
export const EMOJI_CHARS = new Set(EMOJI_ITEMS.map((x) => x.e));
