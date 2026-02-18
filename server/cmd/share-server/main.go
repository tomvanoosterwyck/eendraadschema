package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"eendraadschema-share-server/internal/api"
	"eendraadschema-share-server/internal/config"
	"eendraadschema-share-server/internal/store"
	"eendraadschema-share-server/internal/web"
)

func main() {
	cfg := config.Load()
	logAppEnvironment("EDS_SHARE_")

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
	root.HandleFunc("/runtime-config.js", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")

		// Only include non-secret configuration intended for the browser.
		// We intentionally do NOT expose any passwords, DSNs, tokens, etc.
		publicCfg := map[string]string{
			"VITE_OIDC_ISSUER_URL": cfg.OIDCIssuerURL,
			"VITE_OIDC_CLIENT_ID":  cfg.OIDCClientID,
			"VITE_OIDC_AUDIENCE":   cfg.OIDCAudience,
			"VITE_OIDC_SCOPE":              os.Getenv("VITE_OIDC_SCOPE"),
			"VITE_OIDC_SILENT_REDIRECT_URI": os.Getenv("VITE_OIDC_SILENT_REDIRECT_URI"),
			"VITE_OIDC_USE_REFRESH_TOKEN":   os.Getenv("VITE_OIDC_USE_REFRESH_TOKEN"),
			"VITE_OIDC_RENEW_SKEW_SECONDS":  os.Getenv("VITE_OIDC_RENEW_SKEW_SECONDS"),
		}
		b, err := json.Marshal(publicCfg)
		if err != nil {
			http.Error(w, "failed to render config", http.StatusInternalServerError)
			return
		}
		_, _ = fmt.Fprintf(w, "window.__EDS_RUNTIME_CONFIG=%s;\n", string(b))
	})
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
	if strings.TrimSpace(cfg.StaticDir) != "" {
		log.Printf("serving static from %s", cfg.StaticDir)
	}
	log.Printf("allowed origin: %q", cfg.AllowedOrigin)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("server error: %v", err)
		os.Exit(1)
	}
}

func logAppEnvironment(prefix string) {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return
	}
	all := os.Environ()
	vals := make(map[string]string)
	for _, kv := range all {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		if strings.HasPrefix(k, prefix) {
			vals[k] = v
		}
	}
	if len(vals) == 0 {
		log.Printf("%s* env: (none set)", prefix)
		return
	}

	keys := make([]string, 0, len(vals))
	for k := range vals {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	log.Printf("%s* env:", prefix)
	for _, k := range keys {
		log.Printf("  %s=%q", k, maskEnvValue(k, vals[k]))
	}
}

func maskEnvValue(key string, value string) string {
	upper := strings.ToUpper(strings.TrimSpace(key))

	// Conservative masking: prefer hiding too much over leaking secrets.
	// This function is used for startup logs.
	if upper == "EDS_SHARE_PASSWORD" ||
		upper == "EDS_SHARE_DB_PASSWORD" ||
		upper == "EDS_SHARE_DB_DSN" {
		return "****"
	}

	secretHints := []string{
		"PASSWORD",
		"PASSWD",
		"SECRET",
		"TOKEN",
		"API_KEY",
		"PRIVATE",
		"CERT",
		"DSN",
		"KEY",
	}
	for _, h := range secretHints {
		if strings.Contains(upper, h) {
			return "****"
		}
	}

	return value
}
