#!/usr/bin/env bash
set -euo pipefail

fixture_root="$(mktemp -d)"
case "$fixture_root" in
  /tmp/*) ;;
  *) exit 1 ;;
esac
trap 'rm -rf -- "$fixture_root"' EXIT

node scripts/prepare-plugin-stdio-fixture.mjs "$fixture_root" \
  | node plugins/narracut/server.mjs \
  | node scripts/verify-plugin-stdio.mjs
