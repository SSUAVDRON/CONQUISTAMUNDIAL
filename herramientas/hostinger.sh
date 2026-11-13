#!/usr/bin/env bash
# Publica la web del juego (index.html = el juego empaquetado en un solo
# archivo, con su JavaScript y su CSS dentro; los mapas en mapas-<huella>.json,
# que se guardan en caché para siempre; .htaccess y la API de api/) en dos pasos:
#
#   bash herramientas/hostinger.sh prueba       → rama «hostinger-prueba»
#        (Hostinger la despliega en …/prueba/: se valida ahí primero)
#   bash herramientas/hostinger.sh produccion   → rama «hostinger»
#        (copia EXACTAMENTE el index.html ya validado en prueba; la raíz de la
#        web despliega esta rama. Después: purgar la caché de la CDN en hPanel)
#
#   MENSAJE="texto" bash herramientas/hostinger.sh prueba
#
# Un solo archivo no puede mezclar versiones: con módulos sueltos, la caché
# podía servir parte del JavaScript antiguo con el HTML nuevo.
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ=$(git rev-parse --show-toplevel)
DESTINO=${1:-}
case "$DESTINO" in
  prueba) RAMA=hostinger-prueba ;;
  produccion) RAMA=hostinger ;;
  *)
    echo "Uso: bash herramientas/hostinger.sh prueba|produccion" >&2
    exit 1
    ;;
esac

TMP=$(mktemp -d)
SRC=$(mktemp -d)
trap 'git -C "$RAIZ" worktree remove --force "$TMP" >/dev/null 2>&1 || rm -rf "$TMP"; rm -rf "$SRC"' EXIT
# (con destino explícito: en clones de una sola rama, «fetch origin rama» no crea origin/rama)
fetch_rama() { git -C "$RAIZ" fetch -q origin "+refs/heads/$1:refs/remotes/origin/$1" 2>/dev/null || true; }

if [ "$DESTINO" = prueba ]; then
  # Solo desde código guardado: el sello de compilación tiene que ser un commit
  if [ -n "$(git -C "$RAIZ" status --porcelain --untracked-files=no)" ] && [ "${FORZAR:-}" != 1 ]; then
    echo "Hay cambios sin guardar: haz commit antes de publicar (o FORZAR=1)." >&2
    exit 1
  fi
  npm run empaquetar >/dev/null
  cp dist/web/index.html dist/web/mapas-*.json "$SRC/"
  # API en PHP (rangos, cuentas y lo común); su configuración va fuera de public_html
  mkdir -p "$SRC/api"
  cp api/*.php api/.htaccess "$SRC/api/"
else
  # Producción: el mismo archivo que se validó en prueba, byte a byte
  fetch_rama hostinger-prueba
  if ! git -C "$RAIZ" show-ref --verify --quiet refs/remotes/origin/hostinger-prueba; then
    echo "No hay rama hostinger-prueba: publica antes en prueba." >&2
    exit 1
  fi
  git -C "$RAIZ" show origin/hostinger-prueba:index.html > "$SRC/index.html"
  # Y el archivo de mapas que pide ese index.html
  for f in $(git -C "$RAIZ" ls-tree --name-only origin/hostinger-prueba | grep '^mapas-.*\.json$' || true); do
    git -C "$RAIZ" show "origin/hostinger-prueba:$f" > "$SRC/$f"
  done
  mkdir -p "$SRC/api"
  # Todos los archivos de api/ tal como están en prueba
  for f in $(git -C "$RAIZ" ls-tree --name-only origin/hostinger-prueba api/ 2>/dev/null); do
    git -C "$RAIZ" show "origin/hostinger-prueba:$f" > "$SRC/$f"
  done
  [ -f "$SRC/api/rangos.php" ] || rm -rf "$SRC/api"
fi
BUILD=$(grep -o '<meta name="trinchera-build" content="[^"]*"' "$SRC/index.html" | sed 's/.*content="//; s/"$//')

fetch_rama "$RAMA"
if git -C "$RAIZ" show-ref --verify --quiet "refs/remotes/origin/$RAMA"; then
  git -C "$RAIZ" worktree add -q -B "$RAMA" "$TMP" "origin/$RAMA"
else
  # Primera vez: rama sin historia, sin nada del resto del repositorio
  git -C "$RAIZ" worktree add -q --detach "$TMP"
  git -C "$TMP" checkout -q --orphan "$RAMA"
  git -C "$TMP" rm -rqf .
fi

cp "$SRC/index.html" "$TMP/index.html"
# Los mapas: solo el que pide este index.html (los de versiones anteriores se quitan)
MAPAS=$(grep -o 'window.__TRINCHERA_MAPAS = "mapas-[0-9a-f]*\.json"' "$SRC/index.html" | grep -o 'mapas-[0-9a-f]*\.json' || true)
if [ -z "$MAPAS" ] || [ ! -f "$SRC/$MAPAS" ]; then
  echo "Falta el archivo de mapas que pide index.html ($MAPAS)." >&2
  exit 1
fi
find "$TMP" -maxdepth 1 -name 'mapas-*.json' -delete
cp "$SRC/$MAPAS" "$TMP/$MAPAS"
cp herramientas/hostinger.htaccess "$TMP/.htaccess"
if [ -d "$SRC/api" ]; then
  # api/ se sustituye entero (si se quita un archivo, también se quita en la web)
  rm -rf "$TMP/api"
  mkdir -p "$TMP/api"
  cp -a "$SRC/api/." "$TMP/api/"
  git -C "$TMP" add -A api
fi
# (la rama solo lleva la web: index.html, .htaccess, los mapas y api/)
git -C "$TMP" add -A
if git -C "$TMP" diff --cached --quiet; then
  echo "La rama $RAMA ya tiene la compilación $BUILD."
  exit 0
fi
git -C "$TMP" commit -q -m "${MENSAJE:-Web ($DESTINO): compilación $BUILD}"
git -C "$TMP" push -q -u origin "$RAMA"
echo "Publicado en $RAMA: compilación $BUILD."
