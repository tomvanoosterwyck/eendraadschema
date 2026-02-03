package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"eendraadschema-share-server/internal/auth"
	"eendraadschema-share-server/internal/config"
	"eendraadschema-share-server/internal/store"

	"github.com/google/uuid"
)

type API struct {
	cfg   config.Config
	store *store.Store
}

func New(cfg config.Config, st *store.Store) *API {
	return &API{cfg: cfg, store: st}
}

func (a *API) hasValidSession(r *http.Request, now time.Time) bool {
	token := auth.GetSessionToken(r, a.cfg)
	if token == "" {
		return false
	}
	_, err := a.store.GetSessionShareID(r.Context(), token, now)
	return err == nil
}

func (a *API) passwordOK(password string) bool {
	// Constant-time compare to reduce leakage.
	if len(password) != len(a.cfg.APIPassword) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(password), []byte(a.cfg.APIPassword)) == 1
}

// requireAuth enforces server-wide authorization.
// If a valid session cookie is present, it's accepted.
// Otherwise, the caller must provide the server password. On success, we issue a session cookie tied to shareID.
func (a *API) requireAuth(w http.ResponseWriter, r *http.Request, now time.Time, password string, shareIDForSession string) bool {
	a.store.CleanupExpiredSessions(r.Context(), now)
	if a.hasValidSession(r, now) {
		return true
	}
	if strings.TrimSpace(password) == "" {
		writeError(w, http.StatusUnauthorized, "password_required", "server password required")
		return false
	}
	if !a.passwordOK(password) {
		writeError(w, http.StatusUnauthorized, "invalid_password", "invalid server password")
		return false
	}

	// Issue session cookie (best-effort)
	if shareIDForSession != "" {
		token := uuid.NewString()
		exp := now.Add(a.cfg.SessionTTL)
		_ = a.store.CreateSession(r.Context(), token, shareIDForSession, exp, now)
		auth.SetSessionCookie(w, a.cfg, token, exp)
	}
	return true
}

type createShareRequest struct {
	Schema   string `json:"schema"`
	Password string `json:"password"`
	BaseURL  string `json:"baseUrl"`
}

type createShareResponse struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

type updateShareRequest struct {
	Schema   string `json:"schema"`
	Password string `json:"password"`
}

type getShareResponse struct {
	ID        string `json:"id"`
	Schema    string `json:"schema"`
	UpdatedAt string `json:"updatedAt"`
}

func (a *API) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/shares", a.handleShares)
	mux.HandleFunc("/api/shares/", a.handleShareByID)
	mux.HandleFunc("/api/healthz", a.handleHealthz)
	return a.withMiddleware(mux)
}

func (a *API) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Preflight
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			if a.cfg.AllowedOrigin != "" {
				w.Header().Set("Access-Control-Allow-Origin", a.cfg.AllowedOrigin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if a.cfg.AllowedOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", a.cfg.AllowedOrigin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}

		// Avoid caching of sensitive share content.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}

		next.ServeHTTP(w, r)
	})
}

func (a *API) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := a.store.HealthCheck(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "unhealthy", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) handleShares(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req createShareRequest
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "invalid json")
		return
	}
	if req.Schema == "" {
		writeError(w, http.StatusBadRequest, "missing_schema", "schema is required")
		return
	}
	if !strings.HasPrefix(req.Schema, "EDS") && !strings.HasPrefix(req.Schema, "TXT") {
		writeError(w, http.StatusBadRequest, "invalid_schema", "schema must start with EDS... or TXT...")
		return
	}

	now := time.Now().UTC()
	// Require auth to create shares.
	if !a.requireAuth(w, r, now, req.Password, "") {
		return
	}

	id := uuid.NewString()

	if err := a.store.CreateShare(r.Context(), id, req.Schema, now); err != nil {
		writeError(w, http.StatusInternalServerError, "db_insert_failed", "could not store share")
		return
	}

	// Create a session for the creator so subsequent calls don't require the password again.
	if !a.hasValidSession(r, now) {
		token := uuid.NewString()
		exp := now.Add(a.cfg.SessionTTL)
		_ = a.store.CreateSession(r.Context(), token, id, exp, now)
		auth.SetSessionCookie(w, a.cfg, token, exp)
	}

	baseURL := strings.TrimSpace(req.BaseURL)
	url := ""
	if baseURL != "" {
		url = baseURL + "#share=" + id
	}
	writeJSON(w, http.StatusCreated, createShareResponse{ID: id, URL: url})
}

func (a *API) handleShareByID(w http.ResponseWriter, r *http.Request) {
	// Path is /api/shares/{id}
	id := strings.TrimPrefix(r.URL.Path, "/api/shares/")
	id = strings.TrimSpace(id)
	if id == "" || strings.Contains(id, "/") {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		a.handleGetShare(w, r, id)
	case http.MethodPut:
		a.handleUpdateShare(w, r, id)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (a *API) handleGetShare(w http.ResponseWriter, r *http.Request, id string) {
	sh, err := a.store.GetShare(r.Context(), id)
	if err != nil {
		if err == store.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "share not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "db_read_failed", "could not read share")
		return
	}
	// Public endpoint: anyone with the UUID can fetch the schema.
	writeJSON(w, http.StatusOK, getShareResponse{ID: sh.ID, Schema: sh.Schema, UpdatedAt: sh.UpdatedAt.Format(time.RFC3339)})
}

func (a *API) handleUpdateShare(w http.ResponseWriter, r *http.Request, id string) {
	r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req updateShareRequest
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "invalid json")
		return
	}
	if req.Schema == "" {
		writeError(w, http.StatusBadRequest, "missing_schema", "schema is required")
		return
	}
	if !strings.HasPrefix(req.Schema, "EDS") && !strings.HasPrefix(req.Schema, "TXT") {
		writeError(w, http.StatusBadRequest, "invalid_schema", "schema must start with EDS... or TXT...")
		return
	}

	sh, err := a.store.GetShare(r.Context(), id)
	if err != nil {
		if err == store.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "share not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "db_read_failed", "could not read share")
		return
	}
	_ = sh

	now := time.Now().UTC()
	if !a.requireAuth(w, r, now, req.Password, id) {
		return
	}

	if err := a.store.UpdateShare(r.Context(), id, req.Schema, now); err != nil {
		if err == store.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "share not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "db_update_failed", "could not update share")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"id": id, "updated": true})
}
