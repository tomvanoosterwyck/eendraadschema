package auth

import (
	"net/http"
	"time"

	"eendraadschema-share-server/internal/config"
)

func SetSessionCookie(w http.ResponseWriter, cfg config.Config, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     cfg.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
	})
}

func GetSessionToken(r *http.Request, cfg config.Config) string {
	c, err := r.Cookie(cfg.CookieName)
	if err != nil {
		return ""
	}
	return c.Value
}
