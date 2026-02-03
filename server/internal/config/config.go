package config

import (
	"os"
	"strconv"
	"time"
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
}

func Load() Config {
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
	}
	return cfg
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
