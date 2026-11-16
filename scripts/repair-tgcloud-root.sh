#!/usr/bin/env bash
# Safe CLI root repair. Does NOT deploy or change Telegram webhook.
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
echo '=== QMR Proxy TGCloud root audit ==='
printf 'Repository root: %s\n' "$HERE"
if [[ ! -d tgcloud/handlers || ! -d tgcloud/lib ]]; then
  echo 'ABORT: required tgcloud/ module folders are missing.' >&2
  exit 3
fi
for f in tgcloud/lib/nodes.js tgcloud/lib/ui.js tgcloud/lib/store.js tgcloud/handlers/message.js tgcloud/handlers/callback_query.js tgcloud/schema.js; do
  if [[ ! -f "$f" ]]; then echo "ABORT: missing $f" >&2; exit 3; fi
  node --check "$f"
done
if [[ ! -d .tgcloud ]]; then
  if [[ -d ../.tgcloud ]]; then
    echo 'Detected CLI workspace state at PARENT directory.'
    echo 'Copying it to repository root, preserving original state and credentials.'
    cp -a ../.tgcloud ./.tgcloud
    chmod 700 .tgcloud
  else
    echo 'No TGCloud local workspace state. Run npx tgcloud login from THIS repository folder.' >&2
    exit 4
  fi
else
  echo 'Existing local .tgcloud state found; will not overwrite it.'
fi
if [[ ! -d .tgcloud ]]; then echo 'Could not prepare local .tgcloud.' >&2; exit 3; fi
# Never print credentials; ensure the local directory is ignored by Git.
if ! git check-ignore -q .tgcloud/; then
  echo 'ABORT: .tgcloud is not ignored by Git. Refusing to continue.' >&2
  exit 5
fi
printf '\nCurrent CLI root should be: %s\n' "$HERE"
echo 'Refreshing read-only Serverless snapshot (not local working files)...'
npx tgcloud fetch
printf '\n=== Detected deployable changes ===\n'
status="$(npx tgcloud --no-pager status)"
printf '%s\n' "$status"
# Require the exact v6 paths to show, before offering deploy advice.
missing=0
for f in tgcloud/handlers/message.js tgcloud/handlers/callback_query.js tgcloud/lib/nodes.js tgcloud/lib/ui.js tgcloud/lib/store.js tgcloud/schema.js; do
  if ! grep -Fq "$f" <<< "$status"; then
    echo "NOT DETECTED: $f" >&2
    missing=1
  fi
done
if [[ "$status" != *'app9239734904'* ]]; then
  echo 'ABORT: unexpected TGCloud bot identity. Must match app9239734904.' >&2
  exit 6
fi
if (( missing )); then
  echo 'ABORT: not all module files are discovered. DO NOT deploy.' >&2
  exit 7
fi
echo 'READY FOR REVIEW: TGCloud can see the expected module paths.'
echo 'This script DID NOT deploy files, migrate database, edit Telegram settings, or change webhook.'
