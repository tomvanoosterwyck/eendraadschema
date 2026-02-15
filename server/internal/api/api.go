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
	oidc  *auth.OIDCVerifier
}

func New(cfg config.Config, st *store.Store) (*API, error) {
	a := &API{cfg: cfg, store: st}
	if strings.TrimSpace(cfg.OIDCIssuerURL) != "" || strings.TrimSpace(cfg.OIDCClientID) != "" {
		v, err := auth.NewOIDCVerifier(context.Background(), cfg)
		if err != nil {
			return nil, err
		}
		a.oidc = v
	}
	return a, nil
}

func (a *API) oidcEnabled() bool { return a.oidc != nil }

func (a *API) requireUser(w http.ResponseWriter, r *http.Request) (auth.User, bool) {
	if a.oidc == nil {
		writeError(w, http.StatusUnauthorized, "oidc_not_enabled", "oidc not enabled")
		return auth.User{}, false
	}
	u, err := a.oidc.VerifyRequest(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
		return auth.User{}, false
	}

	// Best-effort: create/update a DB record for this OIDC user.
	// Do not fail the request if this bookkeeping write fails.
	now := time.Now().UTC()
	_ = a.store.UpsertOIDCUser(r.Context(), u.Sub, u.Email, u.Name, now)
	if a.isBootstrapAdmin(u.Sub) {
		_ = a.store.SetUserAdmin(r.Context(), u.Sub, true, now)
	}
	return u, true
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
	Name     string `json:"name"`
	Schema   string `json:"schema"`
	Password string `json:"password"`
	BaseURL  string `json:"baseUrl"`
	TeamID   string `json:"teamId"`
}

type createShareResponse struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

type updateShareRequest struct {
	Schema   string `json:"schema"`
	Name     *string `json:"name"`
	Password string `json:"password"`
}

type getShareResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name,omitempty"`
	Schema    string `json:"schema"`
	UpdatedAt string `json:"updatedAt"`
}

func (a *API) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/shares", a.handleShares)
	mux.HandleFunc("/api/shares/mine", a.handleMyShares)
	mux.HandleFunc("/api/shares/", a.handleShareByID)
	mux.HandleFunc("/api/teams", a.handleTeams)
	mux.HandleFunc("/api/teams/", a.handleTeamByID)
	mux.HandleFunc("/api/invites/accept", a.handleAcceptInvite)
	mux.HandleFunc("/api/me", a.handleMe)
	mux.HandleFunc("/api/admin/users", a.handleAdminUsers)
	mux.HandleFunc("/api/admin/users/", a.handleAdminUserBySub)
	mux.HandleFunc("/api/admin/shares", a.handleAdminShares)
	mux.HandleFunc("/api/admin/shares/", a.handleAdminShareByID)
	mux.HandleFunc("/api/healthz", a.handleHealthz)
	return a.withMiddleware(mux)
}

func (a *API) isBootstrapAdmin(sub string) bool {
	if strings.TrimSpace(sub) == "" {
		return false
	}
	for _, s := range a.cfg.AdminSubs {
		if s == sub {
			return true
		}
	}
	return false
}

func (a *API) requireAdminUser(w http.ResponseWriter, r *http.Request) (auth.User, bool) {
	u, ok := a.requireUser(w, r)
	if !ok {
		return auth.User{}, false
	}
	isAdmin, err := a.store.IsUserAdmin(r.Context(), u.Sub)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_read_failed", "could not read user")
		return auth.User{}, false
	}
	if !isAdmin {
		writeError(w, http.StatusForbidden, "forbidden", "admin required")
		return auth.User{}, false
	}
	return u, true
}

func (a *API) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Preflight
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
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

	ownerSub := ""
	actorSub := ""
	if a.oidcEnabled() {
		u, ok := a.requireUser(w, r)
		if !ok {
			return
		}
		ownerSub = u.Sub
		actorSub = u.Sub
	} else {
		// Require auth to create shares (legacy password/session mode).
		if !a.requireAuth(w, r, now, req.Password, "") {
			return
		}
	}

	id := uuid.NewString()
	name := strings.TrimSpace(req.Name)
	var teamID *string
	if strings.TrimSpace(req.TeamID) != "" {
		tid := strings.TrimSpace(req.TeamID)
		teamID = &tid
		if ownerSub != "" {
			_, ok, err := a.store.IsTeamMember(r.Context(), tid, ownerSub)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "db_read_failed", "could not read team membership")
				return
			}
			if !ok {
				writeError(w, http.StatusForbidden, "forbidden", "not a team member")
				return
			}
		}
	}

	if err := a.store.CreateShare(r.Context(), id, name, req.Schema, ownerSub, teamID, now); err != nil {
		writeError(w, http.StatusInternalServerError, "db_insert_failed", "could not store share")
		return
	}
	// Store first version (best-effort; don't fail the main request on versioning issues).
	_ = a.store.AddShareVersion(r.Context(), uuid.NewString(), id, req.Schema, actorSub, now)
	if a.cfg.ShareVersionsMax > 0 {
		_ = a.store.PruneShareVersions(r.Context(), id, a.cfg.ShareVersionsMax)
	}

	// Create a session for the creator so subsequent calls don't require the password again.
	// Only relevant for legacy password mode.
	if !a.oidcEnabled() {
		if !a.hasValidSession(r, now) {
			token := uuid.NewString()
			exp := now.Add(a.cfg.SessionTTL)
			_ = a.store.CreateSession(r.Context(), token, id, exp, now)
			auth.SetSessionCookie(w, a.cfg, token, exp)
		}
	}

	baseURL := strings.TrimSpace(req.BaseURL)
	url := ""
	if baseURL != "" {
		url = baseURL + "#share=" + id
	}
	writeJSON(w, http.StatusCreated, createShareResponse{ID: id, URL: url})
}

func (a *API) handleShareByID(w http.ResponseWriter, r *http.Request) {
	// Path is /api/shares/{id} or /api/shares/{id}/versions...
	path := strings.TrimPrefix(r.URL.Path, "/api/shares/")
	path = strings.TrimSpace(path)
	if path == "" {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	parts := strings.Split(path, "/")
	id := strings.TrimSpace(parts[0])
	if id == "" {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	// versions routes
	if len(parts) >= 2 && parts[1] == "versions" {
		a.handleShareVersions(w, r, id, parts[2:])
		return
	}
	if len(parts) != 1 {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		a.handleGetShare(w, r, id)
	case http.MethodPut:
		a.handleUpdateShare(w, r, id)
	case http.MethodDelete:
		a.handleDeleteShare(w, r, id)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (a *API) handleDeleteShare(w http.ResponseWriter, r *http.Request, id string) {
	if !a.oidcEnabled() {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
		return
	}
	u, ok := a.requireUser(w, r)
	if !ok {
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
	if strings.TrimSpace(sh.OwnerSub) == "" || sh.OwnerSub != u.Sub {
		writeError(w, http.StatusForbidden, "forbidden", "not allowed")
		return
	}
	if err := a.store.DeleteShare(r.Context(), id); err != nil {
		if err == store.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "share not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "db_delete_failed", "could not delete share")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "deleted": true})
}

func (a *API) canAccessShare(w http.ResponseWriter, r *http.Request, shareID string) (actorSub string, ok bool) {
	now := time.Now().UTC()
	if a.oidcEnabled() {
		u, okUser := a.requireUser(w, r)
		if !okUser {
			return "", false
		}
		sh, err := a.store.GetShare(r.Context(), shareID)
		if err != nil {
			if err == store.ErrNotFound {
				writeError(w, http.StatusNotFound, "not_found", "share not found")
				return "", false
			}
			writeError(w, http.StatusInternalServerError, "db_read_failed", "could not read share")
			return "", false
		}
		if strings.TrimSpace(sh.OwnerSub) != "" && sh.OwnerSub == u.Sub {
			return u.Sub, true
		}
		if sh.TeamID.Valid {
			_, okMember, err := a.store.IsTeamMember(r.Context(), sh.TeamID.String, u.Sub)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "db_read_failed", "could not read team membership")
				return "", false
			}
			if okMember {
				return u.Sub, true
			}
		}
		writeError(w, http.StatusForbidden, "forbidden", "not allowed")
		return "", false
	}

	// Legacy password/session mode (no per-user auth): accept if session is valid.
	if !a.hasValidSession(r, now) {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
		return "", false
	}
	return "", true
}

func (a *API) handleShareVersions(w http.ResponseWriter, r *http.Request, shareID string, rest []string) {
	actorSub, ok := a.canAccessShare(w, r, shareID)
	_ = actorSub
	if !ok {
		return
	}

	// /api/shares/{id}/versions
	if len(rest) == 0 {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
			return
		}
		items, err := a.store.ListShareVersions(r.Context(), shareID, 200)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "db_read_failed", "could not list share versions")
			return
		}
		out := make([]map[string]any, 0, len(items))
		for _, it := range items {
			out = append(out, map[string]any{
				"id": it.ID,
				"createdAt": it.CreatedAt.UTC().Format(time.RFC3339),
				"createdBySub": it.CreatedBySub,
			})
		}
		writeJSON(w, http.StatusOK, out)
		return
	}

	verID := strings.TrimSpace(rest[0])
	if verID == "" {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}

	// /api/shares/{id}/versions/{ver}
	if len(rest) == 1 {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
			return
		}
		schema, err := a.store.GetShareVersion(r.Context(), shareID, verID)
		if err != nil {
			if err == store.ErrNotFound {
				writeError(w, http.StatusNotFound, "not_found", "version not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "db_read_failed", "could not read share version")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"shareId": shareID, "versionId": verID, "schema": schema})
		return
	}

	// /api/shares/{id}/versions/{ver}/restore
	if len(rest) == 2 && rest[1] == "restore" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
			return
		}
		schema, err := a.store.GetShareVersion(r.Context(), shareID, verID)
		if err != nil {
			if err == store.ErrNotFound {
				writeError(w, http.StatusNotFound, "not_found", "version not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "db_read_failed", "could not read share version")
			return
		}
		now := time.Now().UTC()
		if err := a.store.UpdateShare(r.Context(), shareID, schema, now); err != nil {
			if err == store.ErrNotFound {
				writeError(w, http.StatusNotFound, "not_found", "share not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "db_update_failed", "could not update share")
			return
		}
		// Add a new version entry for the restore action (best-effort)
		actorSub, _ := a.canAccessShare(w, r, shareID)
		_ = a.store.AddShareVersion(r.Context(), uuid.NewString(), shareID, schema, actorSub, now)
		if a.cfg.ShareVersionsMax > 0 {
			_ = a.store.PruneShareVersions(r.Context(), shareID, a.cfg.ShareVersionsMax)
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": shareID, "restored": true, "versionId": verID})
		return
	}

	writeError(w, http.StatusNotFound, "not_found", "not found")
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
	writeJSON(w, http.StatusOK, getShareResponse{ID: sh.ID, Name: strings.TrimSpace(sh.Name), Schema: sh.Schema, UpdatedAt: sh.UpdatedAt.Format(time.RFC3339)})
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
	var schemaPtr *string
	if req.Schema != "" {
		if !strings.HasPrefix(req.Schema, "EDS") && !strings.HasPrefix(req.Schema, "TXT") {
			writeError(w, http.StatusBadRequest, "invalid_schema", "schema must start with EDS... or TXT...")
			return
		}
		s := req.Schema
		schemaPtr = &s
	}
	if schemaPtr == nil && req.Name == nil {
		writeError(w, http.StatusBadRequest, "missing_update", "schema or name is required")
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

	now := time.Now().UTC()
	if a.oidcEnabled() {
		u, ok := a.requireUser(w, r)
		if !ok {
			return
		}
		if strings.TrimSpace(sh.OwnerSub) != "" && sh.OwnerSub == u.Sub {
			// ok
		} else if sh.TeamID.Valid {
			_, okMember, err := a.store.IsTeamMember(r.Context(), sh.TeamID.String, u.Sub)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "db_read_failed", "could not read team membership")
				return
			}
			if !okMember {
				writeError(w, http.StatusForbidden, "forbidden", "not allowed")
				return
			}
		} else {
			writeError(w, http.StatusForbidden, "forbidden", "not allowed")
			return
		}
	} else {
		if !a.requireAuth(w, r, now, req.Password, id) {
			return
		}
	}

	if err := a.store.UpdateShareFields(r.Context(), id, schemaPtr, req.Name, now); err != nil {
		if err == store.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "share not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "db_update_failed", "could not update share")
		return
	}
	// Add version entry (best-effort)
	actorSub := ""
	if a.oidcEnabled() {
		u, ok := a.requireUser(w, r)
		if ok {
			actorSub = u.Sub
		}
	}
	if schemaPtr != nil {
		_ = a.store.AddShareVersion(r.Context(), uuid.NewString(), id, *schemaPtr, actorSub, now)
	}
	if a.cfg.ShareVersionsMax > 0 {
		_ = a.store.PruneShareVersions(r.Context(), id, a.cfg.ShareVersionsMax)
	}

	writeJSON(w, http.StatusOK, map[string]any{"id": id, "updated": true})
}

func (a *API) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	u, ok := a.requireUser(w, r)
	if !ok {
		return
	}
	isAdmin, err := a.store.IsUserAdmin(r.Context(), u.Sub)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_read_failed", "could not read user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sub":     u.Sub,
		"email":   u.Email,
		"name":    u.Name,
		"isAdmin": isAdmin,
	})
}

func (a *API) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	_, ok := a.requireAdminUser(w, r)
	if !ok {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	items, err := a.store.ListUsers(r.Context(), q, 200)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_read_failed", "could not list users")
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, map[string]any{
			"sub":        it.Sub,
			"email":      it.Email,
			"name":       it.Name,
			"isAdmin":    it.IsAdmin,
			"createdAt":  it.CreatedAt.UTC().Format(time.RFC3339),
			"updatedAt":  it.UpdatedAt.UTC().Format(time.RFC3339),
			"lastSeenAt": it.LastSeenAt.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

type adminUpdateUserRequest struct {
	IsAdmin bool `json:"isAdmin"`
}

func (a *API) handleAdminUserBySub(w http.ResponseWriter, r *http.Request) {
	// /api/admin/users/{sub}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	sub := strings.TrimSpace(path)
	if sub == "" {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	_, ok := a.requireAdminUser(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req adminUpdateUserRequest
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "invalid json")
		return
	}
	now := time.Now().UTC()
	if err := a.store.SetUserAdmin(r.Context(), sub, req.IsAdmin, now); err != nil {
		if err == store.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "db_update_failed", "could not update user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sub": sub, "isAdmin": req.IsAdmin})
}

func (a *API) handleAdminShares(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	_, ok := a.requireAdminUser(w, r)
	if !ok {
		return
	}
	items, err := a.store.ListAllShares(r.Context(), 1000)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_read_failed", "could not list shares")
		return
	}
	ownerSubs := make([]string, 0, len(items))
	for _, it := range items {
		if strings.TrimSpace(it.OwnerSub) != "" {
			ownerSubs = append(ownerSubs, it.OwnerSub)
		}
	}
	owners, _ := a.store.GetUsersBySubs(r.Context(), ownerSubs)
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		var tid any
		if it.TeamID.Valid {
			tid = it.TeamID.String
		} else {
			tid = nil
		}
		ownerName := ""
		ownerEmail := ""
		if o, ok := owners[it.OwnerSub]; ok {
			ownerName = strings.TrimSpace(o.Name)
			ownerEmail = strings.TrimSpace(o.Email)
		}
		out = append(out, map[string]any{
			"id":        it.ID,
			"name":      strings.TrimSpace(it.Name),
			"ownerSub":  it.OwnerSub,
			"ownerName": ownerName,
			"ownerEmail": ownerEmail,
			"teamId":    tid,
			"createdAt": it.CreatedAt.UTC().Format(time.RFC3339),
			"updatedAt": it.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) handleAdminShareByID(w http.ResponseWriter, r *http.Request) {
	// /api/admin/shares/{id}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/shares/")
	id := strings.TrimSpace(path)
	if id == "" {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	_, ok := a.requireAdminUser(w, r)
	if !ok {
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
	writeJSON(w, http.StatusOK, getShareResponse{ID: sh.ID, Name: strings.TrimSpace(sh.Name), Schema: sh.Schema, UpdatedAt: sh.UpdatedAt.UTC().Format(time.RFC3339)})
}

func (a *API) handleMyShares(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	u, ok := a.requireUser(w, r)
	if !ok {
		return
	}
	items, err := a.store.ListSharesByOwner(r.Context(), u.Sub, 200)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_read_failed", "could not list shares")
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		var tid any
		if it.TeamID.Valid {
			tid = it.TeamID.String
		} else {
			tid = nil
		}
		out = append(out, map[string]any{
			"id":        it.ID,
			"name":      strings.TrimSpace(it.Name),
			"teamId":    tid,
			"createdAt": it.CreatedAt.UTC().Format(time.RFC3339),
			"updatedAt": it.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

type createTeamRequest struct {
	Name string `json:"name"`
}

func (a *API) handleTeams(w http.ResponseWriter, r *http.Request) {
	u, ok := a.requireUser(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		teams, err := a.store.ListTeamsForUser(r.Context(), u.Sub)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "db_read_failed", "could not list teams")
			return
		}
		out := make([]map[string]any, 0, len(teams))
		for _, t := range teams {
			out = append(out, map[string]any{"id": t.ID, "name": t.Name, "role": t.Role})
		}
		writeJSON(w, http.StatusOK, out)
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxBodyBytes)
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var req createTeamRequest
		if err := dec.Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "bad_json", "invalid json")
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" {
			writeError(w, http.StatusBadRequest, "missing_name", "name is required")
			return
		}
		now := time.Now().UTC()
		id := uuid.NewString()
		if err := a.store.CreateTeam(r.Context(), id, name, u.Sub, now); err != nil {
			writeError(w, http.StatusInternalServerError, "db_insert_failed", "could not create team")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"id": id, "name": name})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

type createInviteRequest struct {
	Email string `json:"email"`
}

func (a *API) handleTeamByID(w http.ResponseWriter, r *http.Request) {
	// Supports: POST /api/teams/{id}/invites
	path := strings.TrimPrefix(r.URL.Path, "/api/teams/")
	path = strings.TrimSpace(path)
	if path == "" {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	parts := strings.Split(path, "/")
	teamID := strings.TrimSpace(parts[0])
	if teamID == "" {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	if len(parts) != 2 || parts[1] != "invites" {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	u, ok := a.requireUser(w, r)
	if !ok {
		return
	}
	role, isMember, err := a.store.IsTeamMember(r.Context(), teamID, u.Sub)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_read_failed", "could not read team membership")
		return
	}
	if !isMember || role != "owner" {
		writeError(w, http.StatusForbidden, "forbidden", "only team owners can invite")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req createInviteRequest
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "invalid json")
		return
	}

	now := time.Now().UTC()
	token := uuid.NewString()
	exp := now.Add(7 * 24 * time.Hour)
	if err := a.store.CreateTeamInvite(r.Context(), token, teamID, strings.TrimSpace(req.Email), u.Sub, exp, now); err != nil {
		writeError(w, http.StatusInternalServerError, "db_insert_failed", "could not create invite")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "expiresAt": exp.Format(time.RFC3339)})
}

type acceptInviteRequest struct {
	Token string `json:"token"`
}

func (a *API) handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	u, ok := a.requireUser(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req acceptInviteRequest
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "invalid json")
		return
	}
	if strings.TrimSpace(req.Token) == "" {
		writeError(w, http.StatusBadRequest, "missing_token", "token is required")
		return
	}
	teamID, err := a.store.AcceptTeamInvite(r.Context(), strings.TrimSpace(req.Token), u.Sub, time.Now().UTC())
	if err != nil {
		if err == store.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "invite not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "db_update_failed", "could not accept invite")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"teamId": teamID, "joined": true})
}
