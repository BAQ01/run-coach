#!/usr/bin/env bash
set -euo pipefail

# Maak een volledige maar veilige projectbackup:
# - neemt broncode en config mee
# - sluit secrets, caches en zware lokale mappen uit
# - maakt een zip in de parent folder van het project

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
DATE_STAMP="$(date +%Y-%m-%d_%H%M)"
OUT_DIR="$(dirname "$PROJECT_DIR")"
ZIP_NAME="${PROJECT_NAME}_backup_safe_${DATE_STAMP}.zip"
ZIP_PATH="${OUT_DIR}/${ZIP_NAME}"

cd "$PROJECT_DIR"

echo "Project: $PROJECT_DIR"
echo "Output : $ZIP_PATH"

# Verwijder oude zip met dezelfde naam als die al bestaat
rm -f "$ZIP_PATH"

# Maak veilige zip
zip -r "$ZIP_PATH" . \
  -x "*/.git/*" \
  -x ".git/*" \
  -x "*/node_modules/*" \
  -x "node_modules/*" \
  -x "*/dist/*" \
  -x "dist/*" \
  -x "*/build/*" \
  -x "build/*" \
  -x "*/.next/*" \
  -x ".next/*" \
  -x "*/coverage/*" \
  -x "coverage/*" \
  -x "*/.vite/*" \
  -x ".vite/*" \
  -x "*/Pods/*" \
  -x "Pods/*" \
  -x "*/DerivedData/*" \
  -x "DerivedData/*" \
  -x "*/.env" \
  -x ".env" \
  -x "*/.env.*" \
  -x ".env.*" \
  -x "!.env.example" \
  -x "*/.claude/*" \
  -x ".claude/*" \
  -x "*/.DS_Store" \
  -x ".DS_Store" \
  -x "*/run-coach_backup*.zip" \
  -x "*/${PROJECT_NAME}_backup_safe_*.zip"

echo
echo "Backup gemaakt:"
echo "$ZIP_PATH"

echo
echo "Controle op gevoelige paden..."
if unzip -l "$ZIP_PATH" | grep -E '(\.env($|\.))|(\.claude/)|(\.git/)|(node_modules/)|(Pods/)' >/dev/null; then
  echo "WAARSCHUWING: er lijken nog gevoelige of uitgesloten bestanden in de zip te zitten."
  echo "Controleer handmatig met:"
  echo "unzip -l \"$ZIP_PATH\" | grep -E '(\\.env|\\.claude|\\.git/|node_modules/|Pods/)'"
  exit 1
fi

echo "OK: geen .env/.claude/.git/node_modules/Pods gevonden in de zip."