#!/bin/sh
set -e

echo "Starting Challenge API v6..."

# Run database migrations
# Prisma uses PostgreSQL advisory locks to prevent concurrent migrations
# Only one instance will run migrations, others will wait
echo "Running database migrations..."
npx prisma migrate deploy

# Check migration status
if [ $? -eq 0 ]; then
    echo "Migrations completed successfully"
else
    echo "Migration failed with exit code $?"
    exit 1
fi

# Start the application
echo "Starting application server..."
exec node /challenge-api/app.js
