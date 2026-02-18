********************************
Eendraadschema Community edition
********************************

## Purpose

Design and draw a one-wire diagram as enforced by the Belgian AREI legislation.
Source code written in Typescript, transpiled to Javascript and run in a browser.

## Build

Ensure you have vite installed, usually this is done using 
```npm install vite@latest```

Then run
```npm run dev```

Open the indicated url in a browser window.

## Optional: quick local commands (Justfile)

If you have `just` installed (macOS: `brew install just`), you can use the repo's `justfile`:

- `just dev-web` (frontend only)
- `just dev-server` (backend only)
- `just dev-all` (frontend + backend together)
- `just serve` (build frontend and serve it from Go on `:8080`)

## Optional: Share backend (short links)

The community edition can run fully client-side, but the default share-link mechanism can produce very long URLs.
This repo includes an optional Go + SQLite backend that stores shared schemas and returns a short UUID-based link.

### Run the backend

In a separate terminal:

```sh
cd server
go run ./cmd/share-server
```

The server listens on `:8080` by default and exposes:

- `POST /api/shares` (create share)
- `PUT /api/shares/{uuid}` (update existing share)
- `GET /api/shares/{uuid}` (get schema)

`POST` and `PUT` are protected by a single server-wide password. The client can send the password once (in the request body) and the server will respond with an HttpOnly session cookie.

`GET` is public: anyone with the UUID link can open the shared schema.

When running `npm run dev`, Vite proxies `/api/*` to `http://localhost:8080`, so cookies/sessions work without CORS hassle.

### Environment variables

Set these when needed:

- `EDS_SHARE_ADDR` (default `:8080`)
- `EDS_SHARE_DB_DRIVER` (default `sqlite`; set to `postgres` for PostgreSQL)
- `EDS_SHARE_DB` (SQLite file path, default `./data/shares.db`)
- `EDS_SHARE_DB_DSN` (PostgreSQL DSN, required when `EDS_SHARE_DB_DRIVER=postgres`)
- `EDS_SHARE_PASSWORD` (default `ChangeMe123!`)
- `EDS_SHARE_STATIC_DIR` - if set, the Go server also serves the frontend static files from this directory (SPA fallback to `index.html`).
- `EDS_SHARE_SESSION_TTL_HOURS` (default `168`)
- `EDS_SHARE_MAX_BODY_BYTES` (default `8388608`)
- `EDS_SHARE_COOKIE` (default `eds_session`)
- `EDS_SHARE_COOKIE_SECURE` (default `false` for localhost)
- `EDS_SHARE_ALLOWED_ORIGIN` (default empty; set if you are not using the Vite proxy)

OIDC (optional; when enabled, share *write* actions require login):

- `EDS_SHARE_OIDC_ISSUER_URL` (e.g. `https://auth.example.com/realms/myrealm`)
- `EDS_SHARE_OIDC_CLIENT_ID` (OIDC client id)
- `EDS_SHARE_OIDC_AUDIENCE` (optional; comma-separated audiences; defaults to client id)

Frontend (Vite) OIDC variables (optional):

- `VITE_OIDC_ISSUER_URL`
- `VITE_OIDC_CLIENT_ID`
- `VITE_OIDC_AUDIENCE` (optional)
- `VITE_OIDC_SCOPE` (optional; default `openid profile email`)

Token renewal (optional, IdP-independent):

By default the frontend will not be able to renew an expired token without a fresh login.
To enable background renewal, configure *one* of the standard OIDC approaches below:

- Refresh-token based renewal (recommended when your IdP supports it for SPAs):
	- `VITE_OIDC_USE_REFRESH_TOKEN=true`
	- Ensure your `VITE_OIDC_SCOPE` includes whatever your IdP requires to issue refresh tokens (often `offline_access`).

- Silent-redirect (iframe) based renewal:
	- `VITE_OIDC_SILENT_REDIRECT_URI` (a URL on this app origin that can complete the silent callback)

Optional tuning:

- `VITE_OIDC_RENEW_SKEW_SECONDS` (default `30`) renew this many seconds before expiry.

Example PostgreSQL DSN:

```sh
export EDS_SHARE_DB_DRIVER=postgres
export EDS_SHARE_DB_DSN='postgres://user:pass@localhost:5432/eendraadschema?sslmode=disable'
```

#### .env support (local testing)

For convenience, the Go share-server will also try to load `.env` / `.env.local` files (non-fatal, and it will not overwrite already-set env vars):

- Put backend variables in `server/.env` (see `server/.env.example`).
- Put frontend variables in `.env.local` (see `.env.example`).

A single file version can be built using
```npm run build```

This will create a single "`index.html`" file in the "`dist`"-folder
The "`index.html`"-file will still need all the resources in the root folder so must be renamed and
copied into the root-folder to get a working application.
The default build configuration is only provided as an example.

## License

See LICENSE.md

## Frequent questions

### Do you have commercial plans?

No.

For me this is 100% a hobby-activity that I work on when and how I see fit.
It helps me to learn new skills and keep the brain cells activated.
I prefer to manage this project with as little constraints as possible. 

Any commercialisation would interfere with the freedom that I currently enjoy.
I therefore have no plans in that direction.

### Can I contribute?

Thanks for asking, but at present I manage this as a 1-person project and intend to keep
it that way for the foreseeable time.

The code is supplied as is for people that can use parts of it in other GPL projects.
An added benefit is that having the code out in the open provides people with a guarantee
that they will always be able to open and edit their EDS files, even if my own website
where I host this tool would go down for some reason.

I cannot state with 100% certainty that I will never change my mind and
accept contributions in the future, but don't start working on this code with that specific end-state in mind.
I hate to say no, but I most probably will.

### Have you considered a framework like Angular, React, ...

Yes, and one day that might actually happen, but that day is not today.
Some earlier experiments were not entirely convincing as far as performance is concerned
and have reduced my appetite.

In addition, given the small size of the project, the old-school javascript-approach is at present
not holding me back in any way.  If the project grows significantly larger, that assessment might change.
Having gone through some refactorings before in this and other projects, 
I am confident that I will be able to manage that problem when it presents itself.