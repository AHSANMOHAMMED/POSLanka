#!/bin/bash
# Script to apply RLS fix to Railway database

echo "Applying RLS fix to Railway database..."

# Extract database connection details from DATABASE_URL_ADMIN
DATABASE_URL="postgresql://postgres:GscoHkXwSOTswMQdTxxUFjanduCKHaDV@gondola.proxy.rlwy.net:31245/railway"

# Run the comprehensive RLS SQL file
echo "Running comprehensive RLS fix..."
psql "$DATABASE_URL" -f drizzle/rls_comprehensive.sql

if [ $? -eq 0 ]; then
    echo "✅ RLS fix applied successfully!"
else
    echo "❌ Failed to apply RLS fix"
    exit 1
fi