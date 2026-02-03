# syntax=docker/dockerfile:1

# --- Frontend build ---
FROM --platform=$BUILDPLATFORM node:22-alpine AS webbuild
WORKDIR /app

# Install deps first (better layer caching)
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy the rest and build
COPY . .
RUN yarn build


# --- Backend build ---
FROM --platform=$BUILDPLATFORM golang:1.25 AS gobuild
WORKDIR /src/server

ARG TARGETOS
ARG TARGETARCH

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/share-server ./cmd/share-server


# --- Runtime prep (create writable data dir) ---
FROM alpine:3.20 AS prep
RUN mkdir -p /out/data


# --- Runtime ---
FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app

# Writable data dir for SQLite (works even without a volume mount)
COPY --from=prep --chown=65532:65532 /out/data ./data

# Backend binary
COPY --from=gobuild --chown=65532:65532 /out/share-server ./share-server

# Frontend static assets
COPY --from=webbuild --chown=65532:65532 /app/dist ./dist

ENV EDS_SHARE_ADDR=:8080
ENV EDS_SHARE_DB_DRIVER=sqlite
ENV EDS_SHARE_DB=/app/data/shares.db
ENV EDS_SHARE_STATIC_DIR=/app/dist

EXPOSE 8080

# Note: configure EDS_SHARE_PASSWORD in deployment; default is ChangeMe123!
ENTRYPOINT ["/app/share-server"]
