#!/bin/sh
set -eu

echo "Starting Challenge API v6..."

echo "Running database migrations..."
pnpm exec prisma migrate deploy
echo "Migrations completed successfully"

echo "Starting application server..."
exec node dist/main.js
