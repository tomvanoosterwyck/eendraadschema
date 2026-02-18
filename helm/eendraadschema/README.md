# Helm chart: eendraadschema

This chart deploys the Go share-server (and the built frontend static assets served by it).

## Install

```sh
helm install eendraadschema ./helm/eendraadschema \
  --set image.repository=ghcr.io/<org>/<repo> \
  --set image.tag=<tag>
```

## External PostgreSQL (no DB Deployment in this chart)

Set the driver to `postgres` and provide the DSN via an externally-managed Secret.

This chart will NOT create Secret manifests unless you explicitly set `secrets.create=true`.

```sh
helm install eendraadschema ./helm/eendraadschema \
  --set image.repository=ghcr.io/<org>/<repo> \
  --set config.db.driver=postgres \
  --set secrets.existingSecret=my-eds-secret
```

Or reference an existing secret:

```sh
helm install eendraadschema ./helm/eendraadschema \
  --set image.repository=ghcr.io/<org>/<repo> \
  --set config.db.driver=postgres \
  --set secrets.existingSecret=my-eds-secret
```

Your existing secret should contain keys:

- `EDS_SHARE_DB_DSN`
- `EDS_SHARE_PASSWORD` (optional)

Key names can be overridden via `secrets.dbDsnKey` and `secrets.passwordKey`.

### GitOps: inject credentials via envFrom/env

If you prefer not to use `secrets.*` at all, inject environment variables directly:

```yaml
config:
  db:
    driver: postgres

# DSN can omit username/password when you provide them separately.
env:
  - name: EDS_SHARE_DB_DSN
    value: postgres://host:5432/db?sslmode=require

envFrom:
  - secretRef:
      name: my-eds-secret
```

Where `my-eds-secret` contains either:

- `EDS_SHARE_DB_DSN` (and optionally `EDS_SHARE_PASSWORD`), OR
- `EDS_SHARE_DB_USER` and `EDS_SHARE_DB_PASSWORD` (and optionally `EDS_SHARE_PASSWORD`) if you prefer not to embed credentials into the DSN.

## Environment variables

All supported `EDS_SHARE_*` options are exposed under `values.yaml` in `config` / `secrets`:

- Non-sensitive settings are in `config` and rendered into a ConfigMap.
- Sensitive settings (`EDS_SHARE_PASSWORD`, `EDS_SHARE_DB_DSN`) are in `secrets` and rendered into a Secret (or referenced from `secrets.existingSecret`).

### OIDC silent renew (frontend)

The SPA reads non-secret OIDC settings from `/runtime-config.js`.
To enable silent renewal, configure these chart values:

```yaml
config:
  oidc:
    # iframe-based renewal callback (same-origin)
    silentRedirectUri: "https://app.example.com/?silent-renew=1"
    renewSkewSeconds: 30

    # or refresh-token based renewal (if supported by your IdP)
    # useRefreshToken: true
    # scope: "openid profile email offline_access"
```

## SQLite persistence

When using SQLite (`config.db.driver=sqlite`), keep `persistence.enabled=true` so `/app/data` is backed by a PVC.
