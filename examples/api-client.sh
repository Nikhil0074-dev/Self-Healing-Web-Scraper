#!/usr/bin/env bash
# Example: call the running HTTP API instead of the CLI.
# Start the server first: npm run dev
set -euo pipefail
URL="${1:?Usage: ./api-client.sh <product-url>}"

curl -s -X POST http://127.0.0.1:3000/api/scrape \
  -H "content-type: application/json" \
  -d "{\"url\": \"${URL}\"}" | python3 -m json.tool
