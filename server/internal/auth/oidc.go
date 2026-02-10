package auth

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"eendraadschema-share-server/internal/config"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrNoBearerToken   = errors.New("no bearer token")
	ErrOIDCNotEnabled  = errors.New("oidc not enabled")
	ErrInvalidAudience = errors.New("invalid audience")
)

type User struct {
	Sub   string `json:"sub"`
	Email string `json:"email,omitempty"`
	Name  string `json:"name,omitempty"`
}

type contextKey string

const userContextKey contextKey = "eds_user"

func WithUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, userContextKey, u)
}

func UserFromContext(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(userContextKey).(User)
	return u, ok
}

type oidcDiscovery struct {
	Issuer  string `json:"issuer"`
	JWKSURI string `json:"jwks_uri"`
}

type jwkSet struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`

	// RSA
	N string `json:"n"`
	E string `json:"e"`

	// EC
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

type IDTokenClaims struct {
	jwt.RegisteredClaims
	Email             string `json:"email,omitempty"`
	Name              string `json:"name,omitempty"`
	PreferredUsername string `json:"preferred_username,omitempty"`
}

// OIDCVerifier verifies JWT access tokens or ID tokens issued by an OIDC provider.
// It performs OIDC discovery and keeps a cached JWKS.
//
// Currently supports RS256 and ES256.
//
// Env configuration is provided via config.Config.
//
// Note: This verifier is intended for a small backend and does not implement
// every corner of the OIDC spec (e.g. token introspection).
// It verifies signatures and standard JWT claims.
//
// A missing or invalid bearer token should be treated as unauthenticated.
//
// To enable: set EDS_SHARE_OIDC_ISSUER_URL and EDS_SHARE_OIDC_CLIENT_ID.
// Optional: EDS_SHARE_OIDC_AUDIENCE (comma-separated; defaults to client_id).
//
type OIDCVerifier struct {
	issuerURL string
	clientID  string
	audiences []string

	httpClient *http.Client

	jwksURI string

	mu          sync.Mutex
	keys        map[string]crypto.PublicKey
	keysFetched time.Time
}

func NewOIDCVerifier(ctx context.Context, cfg config.Config) (*OIDCVerifier, error) {
	issuer := strings.TrimSpace(cfg.OIDCIssuerURL)
	clientID := strings.TrimSpace(cfg.OIDCClientID)
	if issuer == "" || clientID == "" {
		return nil, ErrOIDCNotEnabled
	}
	issuer = strings.TrimRight(issuer, "/")

	auds := parseAudiences(cfg.OIDCAudience, clientID)

	v := &OIDCVerifier{
		issuerURL: issuer,
		clientID:  clientID,
		audiences: auds,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		keys: map[string]crypto.PublicKey{},
	}

	if err := v.discover(ctx); err != nil {
		return nil, err
	}
	if err := v.refreshKeys(ctx); err != nil {
		return nil, err
	}
	return v, nil
}

func parseAudiences(raw string, fallback string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{fallback}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return []string{fallback}
	}
	return out
}

func (v *OIDCVerifier) discover(ctx context.Context) error {
	issuer := strings.TrimRight(v.issuerURL, "/")
	url := issuer + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := v.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("oidc discovery failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("oidc discovery http %d", resp.StatusCode)
	}
	var d oidcDiscovery
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return fmt.Errorf("oidc discovery decode failed: %w", err)
	}
	if strings.TrimSpace(d.JWKSURI) == "" {
		return fmt.Errorf("oidc discovery missing jwks_uri")
	}
	v.jwksURI = d.JWKSURI
	return nil
}

func (v *OIDCVerifier) refreshKeys(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURI, nil)
	if err != nil {
		return err
	}
	resp, err := v.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("jwks fetch failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("jwks fetch http %d", resp.StatusCode)
	}
	var set jwkSet
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return fmt.Errorf("jwks decode failed: %w", err)
	}
	keys := map[string]crypto.PublicKey{}
	for _, k := range set.Keys {
		kid := strings.TrimSpace(k.Kid)
		if kid == "" {
			continue
		}
		pk, err := jwkToPublicKey(k)
		if err != nil {
			continue
		}
		keys[kid] = pk
	}
	if len(keys) == 0 {
		return fmt.Errorf("jwks contained no usable keys")
	}

	v.mu.Lock()
	defer v.mu.Unlock()
	v.keys = keys
	v.keysFetched = time.Now().UTC()
	return nil
}

func jwkToPublicKey(k jwk) (crypto.PublicKey, error) {
	switch k.Kty {
	case "RSA":
		if k.N == "" || k.E == "" {
			return nil, fmt.Errorf("rsa jwk missing n/e")
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			return nil, err
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			return nil, err
		}
		n := new(big.Int).SetBytes(nBytes)
		e := 0
		for _, b := range eBytes {
			e = e<<8 + int(b)
		}
		if e == 0 {
			return nil, fmt.Errorf("rsa jwk invalid exponent")
		}
		return &rsa.PublicKey{N: n, E: e}, nil
	case "EC":
		if k.Crv == "" || k.X == "" || k.Y == "" {
			return nil, fmt.Errorf("ec jwk missing crv/x/y")
		}
		xBytes, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil {
			return nil, err
		}
		yBytes, err := base64.RawURLEncoding.DecodeString(k.Y)
		if err != nil {
			return nil, err
		}
		var curve elliptic.Curve
		switch k.Crv {
		case "P-256":
			curve = elliptic.P256()
		case "P-384":
			curve = elliptic.P384()
		case "P-521":
			curve = elliptic.P521()
		default:
			return nil, fmt.Errorf("unsupported ec curve: %s", k.Crv)
		}
		x := new(big.Int).SetBytes(xBytes)
		y := new(big.Int).SetBytes(yBytes)
		if !curve.IsOnCurve(x, y) {
			return nil, fmt.Errorf("ec key not on curve")
		}
		return &ecdsa.PublicKey{Curve: curve, X: x, Y: y}, nil
	default:
		return nil, fmt.Errorf("unsupported kty: %s", k.Kty)
	}
}

func (v *OIDCVerifier) VerifyRequest(r *http.Request) (User, error) {
	if strings.TrimSpace(v.issuerURL) == "" {
		return User{}, ErrOIDCNotEnabled
	}
	tokenString := bearerTokenFromRequest(r)
	if tokenString == "" {
		return User{}, ErrNoBearerToken
	}
	return v.VerifyToken(r.Context(), tokenString)
}

func bearerTokenFromRequest(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 {
		return ""
	}
	if !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func (v *OIDCVerifier) VerifyToken(ctx context.Context, tokenString string) (User, error) {
	keyFunc := func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		kid = strings.TrimSpace(kid)
		if kid == "" {
			return nil, fmt.Errorf("missing kid")
		}

		v.mu.Lock()
		pk := v.keys[kid]
		fetched := v.keysFetched
		v.mu.Unlock()

		if pk == nil {
			// Try a refresh (rate-limited by simple time check).
			if time.Since(fetched) > 30*time.Second {
				_ = v.refreshKeys(ctx)
				v.mu.Lock()
				pk = v.keys[kid]
				v.mu.Unlock()
			}
		}
		if pk == nil {
			return nil, fmt.Errorf("unknown kid")
		}
		return pk, nil
	}

	claims := &IDTokenClaims{}
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"RS256", "ES256"}),
		jwt.WithLeeway(60*time.Second),
	)
	tok, err := parser.ParseWithClaims(tokenString, claims, keyFunc)
	if err != nil {
		return User{}, err
	}
	if !tok.Valid {
		return User{}, fmt.Errorf("invalid token")
	}

	if strings.TrimSpace(claims.Subject) == "" {
		return User{}, fmt.Errorf("missing sub")
	}
	if strings.TrimSpace(claims.Issuer) == "" {
		return User{}, fmt.Errorf("missing iss")
	}
	if strings.TrimRight(claims.Issuer, "/") != v.issuerURL {
		return User{}, fmt.Errorf("invalid issuer")
	}
	if !audAllowed(claims.Audience, v.audiences) {
		return User{}, ErrInvalidAudience
	}

	name := strings.TrimSpace(claims.Name)
	if name == "" {
		name = strings.TrimSpace(claims.PreferredUsername)
	}

	return User{
		Sub:   claims.Subject,
		Email: strings.TrimSpace(claims.Email),
		Name:  name,
	}, nil
}

func audAllowed(tokenAud jwt.ClaimStrings, allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, a := range tokenAud {
		for _, okAud := range allowed {
			if a == okAud {
				return true
			}
		}
	}
	return false
}
