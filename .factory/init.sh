#!/usr/bin/env bash
set -euo pipefail

source "$HOME/.config/nvm/nvm.sh"

nvm use >/dev/null
if [ ! -d node_modules ]; then
  pnpm install
fi

if [ -d data-migration ]; then
  (
    cd data-migration
    nvm use 18.19.0 >/dev/null
    if [ ! -d node_modules ]; then
      pnpm install
    fi
  )
fi

if [ ! -f .env.importer.local ]; then
  echo "warning: .env.importer.local is missing; live validation will remain blocked" >&2
fi
