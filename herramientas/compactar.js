// Compacta el JavaScript del paquete sin dependencias: quita los comentarios
// y la sangría, y nada más (no renombra ni reordena). Recorre el código
// distinguiendo cadenas '…' y "…", plantillas `…${…}…` (anidadas),
// expresiones regulares /…/ y comentarios, así que el texto de las cadenas,
// plantillas y expresiones queda intacto. Lo usa herramientas/empaquetar.js;
// tests/compactar.test.js comprueba que la simulación da lo mismo.

// Tras estos caracteres, una «/» empieza una expresión regular (y no es una división)
const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'of', 'in', 'instanceof', 'new', 'delete', 'void', 'throw', 'else', 'do', 'yield', 'await']);

/** El código sin comentarios ni sangría (las líneas vacías también se van). */
export function compactJs(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  // Pila de plantillas: cada entrada cuenta las llaves abiertas dentro de su ${…}
  const tpl = [];
  let lastSig = ''; // último carácter significativo fuera de comentarios
  let lastWord = ''; // última palabra (para «return /x/»)
  let lineStart = true;

  const emit = (s) => {
    out += s;
  };
  const sig = (ch) => {
    lastSig = ch;
    if (!/[\w$]/.test(ch)) lastWord = '';
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    // Sangría y líneas vacías (solo fuera de cadenas y plantillas: aquí siempre lo estamos)
    if (lineStart && (c === ' ' || c === '\t')) {
      i++;
      continue;
    }
    if (c === '\n') {
      if (!lineStart) emit('\n');
      lineStart = true;
      i++;
      continue;
    }
    // Comentarios
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      // los espacios antes del comentario sobran
      out = out.replace(/[ \t]+$/, '');
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('comentario sin cerrar');
      const body = src.slice(i, end + 2);
      i = end + 2;
      if (lineStart) continue;
      if (body.includes('\n')) {
        // Un comentario de varias líneas cuenta como salto de línea (inserción de «;»)
        out = out.replace(/[ \t]+$/, '');
        emit('\n');
        lineStart = true;
      } else if (/[\w$]$/.test(out) && /[\w$]/.test(src[i] || '')) emit(' '); // separaba dos palabras
      continue;
    }
    lineStart = false;
    // Cadenas
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (src[j] === '\n') throw new Error(`cadena sin cerrar cerca de: ${src.slice(i, i + 40)}`);
        j++;
      }
      emit(src.slice(i, j + 1));
      i = j + 1;
      sig(c);
      continue;
    }
    // Plantillas: el texto se copia tal cual hasta «${» o el cierre
    if (c === '`' || (c === '}' && tpl.length && tpl[tpl.length - 1] === 0)) {
      if (c === '}') tpl.pop();
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new Error('plantilla sin cerrar');
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '`') {
          j++;
          emit(src.slice(i, j));
          sig('`');
          break;
        }
        if (src[j] === '$' && src[j + 1] === '{') {
          j += 2;
          emit(src.slice(i, j));
          tpl.push(0);
          sig('{');
          break;
        }
        j++;
      }
      i = j;
      continue;
    }
    if (c === '{' && tpl.length) tpl[tpl.length - 1]++;
    if (c === '}' && tpl.length) tpl[tpl.length - 1]--;
    // Expresiones regulares
    if (c === '/' && (REGEX_AFTER.has(lastSig) || REGEX_KEYWORDS.has(lastWord))) {
      let j = i + 1;
      let cls = false;
      while (j < n) {
        const ch = src[j];
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (ch === '\n') throw new Error(`expresión regular sin cerrar cerca de: ${src.slice(i, i + 40)}`);
        if (ch === '[') cls = true;
        else if (ch === ']') cls = false;
        else if (ch === '/' && !cls) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      emit(src.slice(i, j));
      i = j;
      sig(')'); // tras una expresión regular, «/» sería una división
      continue;
    }
    // Lo demás, tal cual
    if (/[\w$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      emit(word);
      i = j;
      lastSig = 'a';
      lastWord = word;
      continue;
    }
    emit(c);
    if (c !== ' ' && c !== '\t' && c !== '\r') sig(c);
    i++;
  }
  return out.replace(/[ \t]+\n/g, '\n');
}
