#!/bin/sh

# Replace the placeholder in the built JS files with the actual runtime environment variable
# This allows deploying the same Docker image to different environments in Dokploy
find /usr/share/nginx/html -type f -name "*.js" -exec sed -i "s|__VITE_API_URL_PLACEHOLDER__|${VITE_API_URL:-http://localhost:8080}|g" {} +

# Start nginx
exec "$@"
