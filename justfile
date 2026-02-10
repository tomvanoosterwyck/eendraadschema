# justfile
#
# Install `just` (macOS):
#   brew install just
#
# Optional: create a .env file to override env vars (just loads it automatically).

set dotenv-load := true
set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
  @just --list

# Run frontend + backend together (dev mode).
dev: dev-all

# --- Frontend ---

install:
  yarn install --frozen-lockfile

dev-web:
  yarn dev

build:
  yarn build

preview:
  yarn preview

clean:
  yarn clean

# --- Backend (share server) ---

# Run the Go API server (SQLite by default).
# Env vars you may want in .env:
#   EDS_SHARE_PASSWORD=ChangeMe123!
#   EDS_SHARE_ADDR=:8080
#   EDS_SHARE_DB=./data/shares.db
#   EDS_SHARE_DB_DRIVER=sqlite|postgres
#   EDS_SHARE_DB_DSN=postgres://...

dev-server:
  cd server && air

# Run frontend + backend together (Ctrl-C stops both).
# Uses Vite's proxy for /api.

dev-all:
  #!/usr/bin/env bash
  set -euo pipefail

  mkdir -p server/data

  (cd server && go run ./cmd/share-server) &
  server_pid=$!

  cleanup() {
    kill "$server_pid" 2>/dev/null || true
  }
  trap cleanup EXIT INT TERM

  # If the server can't bind (port in use, etc.), stop immediately.
  sleep 0.2
  if ! kill -0 "$server_pid" 2>/dev/null; then
    wait "$server_pid" || true
    echo "share-server failed to start (is port 8080 already in use?)" >&2
    exit 1
  fi

  yarn dev

# Build the frontend and let the Go server serve it (no Vite).
# App becomes available at http://localhost:8080

serve:
  yarn build
  mkdir -p server/data
  EDS_SHARE_STATIC_DIR="$PWD/dist" (cd server && go run ./cmd/share-server)

# --- Production-ish local run (build artifacts + run binary) ---

prod-build:
  yarn build
  mkdir -p bin
  cd server && go build -o ../bin/share-server ./cmd/share-server

prod-run:
  mkdir -p server/data
  EDS_SHARE_STATIC_DIR="$PWD/dist" ./bin/share-server

prod: prod-build prod-run

# --- Quality checks ---

go-test:
  cd server && go test ./...

# --- Docker ---

docker-build:
  docker build -t eendraadschema-allinone:dev .

docker-up:
  docker compose up --build

docker-up-postgres:
  docker compose --profile postgres up --build

docker-down:
  docker compose down
