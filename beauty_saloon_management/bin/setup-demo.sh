#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

if [[ ! -f .env ]]; then
    cp .env.example .env
    sed -i 's/^STUDIO_DEMO=false$/STUDIO_DEMO=true/' .env
fi

composer install --no-interaction --prefer-dist
php artisan config:clear
php artisan studio:prepare-demo

printf '\nReady: run composer dev, then open http://127.0.0.1:8088/login\n'
