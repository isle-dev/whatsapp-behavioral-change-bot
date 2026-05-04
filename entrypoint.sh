#!/bin/sh
set -e

# Fly.io mounts the volume at /app/data as root. Set up dirs and fix ownership.
mkdir -p /app/data /app/data/.wwebjs_auth /app/data/.wwebjs_cache
chown -R chatbot:nodejs /app/data

# Symlink wwebjs dirs into the volume so session survives redeploys
ln -sfn /app/data/.wwebjs_auth /app/.wwebjs_auth
ln -sfn /app/data/.wwebjs_cache /app/.wwebjs_cache

exec su-exec chatbot node dist/index.js
