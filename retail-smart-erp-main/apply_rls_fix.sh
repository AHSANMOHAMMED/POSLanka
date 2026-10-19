#!/bin/bash
# Script to apply RLS fix to database
set -e

echo "Applying RLS fix to database..."

TARGET_DB_URL="${DATABASE_URL_ADMIN:-$DATABASE_URL}"

if [ -z "$TARGET_DB_URL" ]; then
    echo "❌ Error: DATABASE_URL or DATABASE_URL_ADMIN environment variable must be set."
    echo "Usage: DATABASE_URL=\"postgresql://...\" ./apply_rls_fix.sh"
    exit 1
fi

# Run the comprehensive RLS SQL file
echo "Running comprehensive RLS fix..."
psql "$TARGET_DB_URL" -f drizzle/rls_comprehensive.sql

echo "✅ RLS fix applied successfully!"