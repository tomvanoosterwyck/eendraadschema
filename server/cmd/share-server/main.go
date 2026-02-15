package main

import (
	"log"
	"net/url"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"eendraadschema-share-server/internal/api"
	"eendraadschema-share-server/internal/config"
	"eendraadschema-share-server/internal/store"
	"eendraadschema-share-server/internal/web"
)

func main() {
	cfg := config.Load()

	if strings.EqualFold(cfg.DBDriver, "sqlite") || strings.TrimSpace(cfg.DBDriver) == "" {
		if dir := filepath.Dir(cfg.DBPath); dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				log.Fatalf("failed to create db dir: %v", err)
			}
		}
	}

	st, err := store.Open(cfg)
	if err != nil {
		log.Fatalf("failed to open db: %v", err)
	}
	defer st.Close()

	h, err := api.New(cfg, st)
	if err != nil {
		log.Fatalf("failed to init api: %v", err)
	}
	apiHandler := h.Routes()

	staticHandler, err := web.StaticHandler(cfg.StaticDir)
	if err != nil {
		log.Fatalf("failed to set up static handler: %v", err)
	}

	root := http.NewServeMux()
	root.Handle("/api/", apiHandler)
	root.Handle("/api", apiHandler)
	if staticHandler != nil {
		root.Handle("/", staticHandler)
	} else {
		root.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			http.NotFound(w, r)
		})
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           root,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("share server listening on %s (dbDriver=%s)", cfg.Addr, cfg.DBDriver)
	if driver := strings.ToLower(strings.TrimSpace(cfg.DBDriver)); driver == "postgres" || driver == "postgresql" || driver == "pg" {
		pgUser := strings.TrimSpace(os.Getenv("EDS_SHARE_DB_USER"))
		log.Printf("EDS_SHARE_DB_USER=%q", pgUser)
		log.Printf("EDS_SHARE_DB_DSN=%q", sanitizePostgresDSN(cfg.PostgresDSN))
	}
	if strings.TrimSpace(cfg.StaticDir) != "" {
		log.Printf("serving static from %s", cfg.StaticDir)
	}
	log.Printf("allowed origin: %q", cfg.AllowedOrigin)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("server error: %v", err)
		os.Exit(1)
	}
}

func sanitizePostgresDSN(dsn string) string {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		return ""
	}
	if u, err := url.Parse(dsn); err == nil {
		if u.Scheme == "postgres" || u.Scheme == "postgresql" {
			if u.User != nil {
				u.User = url.User(u.User.Username())
			}
			return u.String()
		}
	}

	// Best-effort scrubbing for keyword/value DSN style.
	// Example: "host=... user=... password=... dbname=..."
	lower := strings.ToLower(dsn)
	idx := strings.Index(lower, "password=")
	if idx == -1 {
		return dsn
	}
	end := idx + len("password=")
	for end < len(dsn) && dsn[end] != ' ' && dsn[end] != '\t' {
		end++
	}
	return dsn[:idx] + "password=***" + dsn[end:]
}
