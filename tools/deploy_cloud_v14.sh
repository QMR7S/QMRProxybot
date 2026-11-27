#!/usr/bin/env bash
# Controlled owner-side release. No token printing, no resets, no force push.
set -euo pipefail
umask 077
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$(cd "${1:?baseline revision-5 release directory required}" && pwd)"
BACKUP="$(cd "${2:?39-file static backup directory required}" && pwd)"
test -d "$BASELINE/.tgcloud" && test -d "$BASELINE/node_modules" || { echo "STOP: missing linked revision-5 checkout"; exit 1; }
R="$(mktemp -d "$HOME/QMRCloud_V14.XXXXXX")"
echo "RELEASE: $R"
trap 'echo "Release files retained: $R"' EXIT
cd "$REPO"
python3 -m unittest discover -s tests -v
npm run test:bot
node --test tests/cloud_boards.test.mjs tests/extra_cloud.test.mjs
python3 tools/cloud_v14_stage.py "$BACKUP" "$R/cloud-dist"
cp -a "$BASELINE/.tgcloud" "$BASELINE/tgcloud" "$R/"
cp package.json "$R/"
ln -s "$BASELINE/node_modules" "$R/node_modules"
cd "$R"
unset TGCLOUD_TOKEN
npx --no-install tgcloud fetch
STATUS="$(npx --no-install tgcloud status)"
printf '%s\n' "$STATUS"
[[ "$STATUS" == *app9239734904* && "$STATUS" == *"Local revision: 5"* && "$STATUS" == *"Working directory clean."* && "$STATUS" == *"Webhook: in sync"* ]] || { echo "STOP: cloud does not match stable revision 5"; exit 1; }
# The baseline contains the exact seven modules previously deployed. Never
# copy review-only V13 libraries or unrelated reference files into the release.
for f in schema.js lib/ui.js lib/cloud_boards_core.js lib/cloud_boards.js lib/extra_cloud.js endpoints/qmr_admin.js endpoints/qmr_ops.js handlers/message.js handlers/callback_query.js; do
 mkdir -p "$R/tgcloud/$(dirname "$f")"
 cp "$REPO/tgcloud/$f" "$R/tgcloud/$f"
done
while IFS= read -r -d '' f; do node --check "$f"; done < <(find tgcloud cloud-dist -name '*.js' -type f -print0)
CTX="{initData:{user:{id:6246913670},auth_date:$(date +%s)}}"
BAD="{initData:{user:{id:1},auth_date:$(date +%s)}}"
echo "=== LIVE SDK READ-ONLY PREFLIGHT ==="
if ! npx --no-install tgcloud run endpoints/qmr_ops '{}' --ctx "$CTX" > "$R/ops-preflight.private.log" 2>&1 ||
   ! grep -q bot_api_verified "$R/ops-preflight.private.log" ||
   ! grep -q activity "$R/ops-preflight.private.log"; then
 echo "STOP: SDK ops preflight did not verify; inspect $R/ops-preflight.private.log privately (no deployment)."
 exit 1
fi
# Some CLI versions return zero even when the invoked module throws. Require
# explicit denial evidence and absence of protected summary fields.
npx --no-install tgcloud run endpoints/qmr_admin '{op:"summary"}' --ctx "$BAD" > "$R/denied.private.log" 2>&1 || true
if ! grep -Eq 'OWNER_ONLY|حساب المالك' "$R/denied.private.log" ||
   grep -Eq 'activity:|maintenance:|users:|events:' "$R/denied.private.log"; then
 echo "STOP: denial not verified; private log retained"; exit 1
fi
echo "SDK AND OWNER GATE: PASS"
echo "=== ADDITIVE SCHEMA ONLY (LOCAL PREVIEW; NO CLOUD WRITE YET) ==="
npx --no-install tgcloud migrate --local --dry-run
echo "Only the new qmr_board_audit_v14 table may be added. If anything else appears, stop."
read -r -p "Type ADD_AUDIT_TABLE to continue: " ANSWER
[[ "$ANSWER" == "ADD_AUDIT_TABLE" ]] || exit 1
npx --no-install tgcloud push schema
npx --no-install tgcloud migrate --safe
npx --no-install tgcloud migrate --dry-run | tee "$R/migration-final.log"
grep -q "No schema changes" "$R/migration-final.log"
echo "=== OWNER SUMMARY READ TEST ==="
CTX="{initData:{user:{id:6246913670},auth_date:$(date +%s)}}"
npx --no-install tgcloud run endpoints/qmr_admin '{op:"summary"}' --ctx "$CTX" > "$R/admin-preflight.private.log" 2>&1
grep -q maintenance "$R/admin-preflight.private.log"
grep -q events "$R/admin-preflight.private.log"
echo "ADMIN READ: PASS"
# The complete previously verified 39-file static tree + one adapter file.
# No static:false, no wildcard source, no review-only modules.
printf '%s\n' '{"static":{"source":"cloud-dist","spa":false}}' > tgcloud.jsonc
STATUS="$(npx --no-install tgcloud status)"
printf '%s\n' "$STATUS"
if grep -Eiq '(^Deleted:|will be deleted|removed files)' <<< "$STATUS"; then
 echo "STOP: deletion reported"; exit 1
fi
echo "Full push will deploy the complete staged static tree and expected modules."
echo "Do not proceed if the status lists unexpected changes."
read -r -p "Type DEPLOY_CLOUD_V14 to publish: " ANSWER
[[ "$ANSWER" == "DEPLOY_CLOUD_V14" ]] || exit 1
npx --no-install tgcloud push
npx --no-install tgcloud fetch
npx --no-install tgcloud status
npx --no-install tgcloud webhook
npx --no-install tgcloud migrate --dry-run
python3 "$REPO/tools/cloud_v14_stage.py" "$BACKUP" "$R/cloud-dist" --verify-release
echo "DEPLOYED FILE HASHES VERIFIED. Test actual Telegram /start, /extra, Admin, Ops and non-owner denial."
echo "V13 broadcast stays disabled; quality cannot claim independent TCP tests."
