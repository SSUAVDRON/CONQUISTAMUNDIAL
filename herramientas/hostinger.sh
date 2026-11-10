#!/usr/bin/env bash
# Publica la web del juego (index.html = el juego empaquetado en un solo
# archivo, con su JavaScript y su CSS dentro, más .htaccess y la API de
# rangos api/rangos.php) en dos pasos:
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
  cp dist/dominia.html "$SRC/index.html"
  # API de la tabla de rangos (PHP); su configuración va fuera de public_html
  mkdir -p "$SRC/api"
  cp api/rangos.php api/.htaccess "$SRC/api/"
else
  # Producción: el mismo archivo que se validó en prueba, byte a byte
  fetch_rama hostinger-prueba
  if ! git -C "$RAIZ" show-ref --verify --quiet refs/remotes/origin/hostinger-prueba; then
    echo "No hay rama hostinger-prueba: publica antes en prueba." >&2
    exit 1
  fi
  git -C "$RAIZ" show origin/hostinger-prueba:index.html > "$SRC/index.html"
  mkdir -p "$SRC/api"
  git -C "$RAIZ" show origin/hostinger-prueba:api/rangos.php > "$SRC/api/rangos.php" 2>/dev/null || rm -rf "$SRC/api"
  [ -d "$SRC/api" ] && git -C "$RAIZ" show origin/hostinger-prueba:api/.htaccess > "$SRC/api/.htaccess" 2>/dev/null || true
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
cp herramientas/hostinger.htaccess "$TMP/.htaccess"
if [ -d "$SRC/api" ]; then
  mkdir -p "$TMP/api"
  cp "$SRC/api/rangos.php" "$TMP/api/rangos.php"
  [ -f "$SRC/api/.htaccess" ] && cp "$SRC/api/.htaccess" "$TMP/api/.htaccess"
  git -C "$TMP" add api
fi
git -C "$TMP" add index.html .htaccess
if git -C "$TMP" diff --cached --quiet; then
  echo "La rama $RAMA ya tiene la compilación $BUILD."
  exit 0
fi
git -C "$TMP" commit -q -m "${MENSAJE:-Web ($DESTINO): compilación $BUILD}"
git -C "$TMP" push -q -u origin "$RAMA"
echo "Publicado en $RAMA: compilación $BUILD."
