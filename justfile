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
  mkdir -p server/data
  cd server && go run ./cmd/share-server

# Run frontend + backend together (Ctrl-C stops both).
# Uses Vite's proxy for /api.

dev-all:
  trap 'kill 0' EXIT
  mkdir -p server/data
  (cd server && go run ./cmd/share-server) &
  yarn dev

# Build the frontend and let the Go server serve it (no Vite).
# App becomes available at http://localhost:8080

serve:
  yarn build
  mkdir -p server/data
  EDS_SHARE_STATIC_DIR="$PWD/dist" (cd server && go run ./cmd/share-server)

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
