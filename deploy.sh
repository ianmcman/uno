#!/bin/sh
# Run on arrstack after copying site/ server/ package.json Dockerfile into this directory.
set -eu
cd "$(dirname "$0")"
docker compose up -d --build
