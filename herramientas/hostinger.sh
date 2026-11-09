#!/usr/bin/env bash
# Publica la web del juego en la rama «hostinger» del repositorio: solo
# index.html (el juego empaquetado en un único archivo) y .htaccess.
# Hostinger (hPanel → Avanzado → Git) despliega esa rama en el subdominio.
#
#   bash herramientas/hostinger.sh            (desde la carpeta dominia/)
#   MENSAJE="texto" bash herramientas/hostinger.sh
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ=$(git rev-parse --show-toplevel)
RAMA=hostinger

npm run empaquetar >/dev/null
CODIGO=$(git -C "$RAIZ" log -1 --format=%h)

TMP=$(mktemp -d)
trap 'git -C "$RAIZ" worktree remove --force "$TMP" >/dev/null 2>&1 || rm -rf "$TMP"' EXIT
git -C "$RAIZ" fetch -q origin "$RAMA" 2>/dev/null || true
if git -C "$RAIZ" show-ref --verify --quiet "refs/remotes/origin/$RAMA"; then
  git -C "$RAIZ" worktree add -q -B "$RAMA" "$TMP" "origin/$RAMA"
else
  # Primera vez: rama sin historia, sin nada del resto del repositorio
  git -C "$RAIZ" worktree add -q --detach "$TMP"
  git -C "$TMP" checkout -q --orphan "$RAMA"
  git -C "$TMP" rm -rqf .
fi

cp dist/dominia.html "$TMP/index.html"
cp herramientas/hostinger.htaccess "$TMP/.htaccess"
git -C "$TMP" add index.html .htaccess
if git -C "$TMP" diff --cached --quiet; then
  echo "La web ya está al día (código $CODIGO)."
  exit 0
fi
git -C "$TMP" commit -q -m "${MENSAJE:-Web: juego del código $CODIGO}"
git -C "$TMP" push -q -u origin "$RAMA"
echo "Publicado en la rama $RAMA (código $CODIGO)."
