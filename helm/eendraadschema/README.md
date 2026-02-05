# Helm chart: eendraadschema

This chart deploys the Go share-server (and the built frontend static assets served by it).

## Install

```sh
helm install eendraadschema ./helm/eendraadschema \
  --set image.repository=ghcr.io/<org>/<repo> \
  --set image.tag=<tag>
```

## External PostgreSQL (no DB Deployment in this chart)

Set the driver to `postgres` and provide the DSN as a secret:

```sh
helm install eendraadschema ./helm/eendraadschema \
  --set image.repository=ghcr.io/<org>/<repo> \
  --set config.db.driver=postgres \
  --set secrets.dbDsn='postgres://user:pass@host:5432/db?sslmode=require'
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

## Environment variables

All supported `EDS_SHARE_*` options are exposed under `values.yaml` in `config` / `secrets`:

- Non-sensitive settings are in `config` and rendered into a ConfigMap.
- Sensitive settings (`EDS_SHARE_PASSWORD`, `EDS_SHARE_DB_DSN`) are in `secrets` and rendered into a Secret (or referenced from `secrets.existingSecret`).

## SQLite persistence

When using SQLite (`config.db.driver=sqlite`), keep `persistence.enabled=true` so `/app/data` is backed by a PVC.
