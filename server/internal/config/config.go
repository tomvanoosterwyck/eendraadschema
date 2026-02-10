package config

import (
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Addr          string
	DBDriver      string
	DBPath        string
	PostgresDSN   string
	StaticDir     string
	CookieName    string
	CookieSecure  bool
	SessionTTL    time.Duration
	MaxBodyBytes  int64
	AllowedOrigin string
	APIPassword   string

	// Optional OIDC config. When set, share write endpoints (create/update/list/delete)
	// can be locked down to authenticated users.
	OIDCIssuerURL string
	OIDCClientID  string
	// Optional comma-separated audiences to accept (if empty, defaults to OIDCClientID).
	OIDCAudience string

	// Share versioning. On each create/update, we store a version row.
	// Keep only the most recent N versions per share (0 disables pruning).
	ShareVersionsMax int

	// Comma-separated list of OIDC subject IDs that should be treated as admins.
	// Used to bootstrap at least one admin without manual DB edits.
	AdminSubs []string
}

func Load() Config {
	// Optional: load dotenv files for local testing.
	// This is non-fatal and does not overwrite existing environment variables.
	//
	// Supported:
	// - EDS_SHARE_ENV_FILE=/path/to/file (single file)
	// - otherwise tries .env and .env.local in both current directory and repo root (best-effort)
	if f := strings.TrimSpace(os.Getenv("EDS_SHARE_ENV_FILE")); f != "" {
		_ = godotenv.Load(f)
	} else {
		_ = godotenv.Load(".env", ".env.local")
		_ = godotenv.Load("../.env", "../.env.local")
	}

	cfg := Config{
		Addr:          envString("EDS_SHARE_ADDR", ":8080"),
		DBDriver:      envString("EDS_SHARE_DB_DRIVER", "sqlite"),
		DBPath:        envString("EDS_SHARE_DB", "./data/shares.db"),
		PostgresDSN:   envString("EDS_SHARE_DB_DSN", ""),
		StaticDir:     envString("EDS_SHARE_STATIC_DIR", ""),
		CookieName:    envString("EDS_SHARE_COOKIE", "eds_session"),
		CookieSecure:  envBool("EDS_SHARE_COOKIE_SECURE", false),
		SessionTTL:    envDurationHours("EDS_SHARE_SESSION_TTL_HOURS", 168), // 7 days
		MaxBodyBytes:  envInt64("EDS_SHARE_MAX_BODY_BYTES", 8<<20),          // 8 MiB
		AllowedOrigin: envString("EDS_SHARE_ALLOWED_ORIGIN", ""),
		APIPassword:   envString("EDS_SHARE_PASSWORD", "ChangeMe123!"),

		OIDCIssuerURL: envString("EDS_SHARE_OIDC_ISSUER_URL", ""),
		OIDCClientID:  envString("EDS_SHARE_OIDC_CLIENT_ID", ""),
		OIDCAudience:  envString("EDS_SHARE_OIDC_AUDIENCE", ""),

		ShareVersionsMax: envInt("EDS_SHARE_SHARE_VERSIONS_MAX", 50),
		AdminSubs:        envStringList("EDS_SHARE_ADMIN_SUBS"),
	}
	return cfg
}

func envStringList(key string) []string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return i
}

func envString(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func envInt64(key string, def int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	i, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return i
}

func envDurationHours(key string, defHours int) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return time.Duration(defHours) * time.Hour
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return time.Duration(defHours) * time.Hour
	}
	return time.Duration(i) * time.Hour
}
