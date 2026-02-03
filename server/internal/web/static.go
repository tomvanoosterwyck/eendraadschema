package web

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// StaticHandler serves a directory and falls back to index.html for unknown routes.
// This keeps hash-based URLs and refreshes working.
func StaticHandler(staticDir string) (http.Handler, error) {
	if strings.TrimSpace(staticDir) == "" {
		return nil, nil
	}
	info, err := os.Stat(staticDir)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, os.ErrInvalid
	}

	indexPath := filepath.Join(staticDir, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		return nil, err
	}

	fs := http.FileServer(http.Dir(staticDir))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Serve exact file if it exists; otherwise fall back to index.html.
		p := r.URL.Path
		if p == "" || p == "/" {
			http.ServeFile(w, r, indexPath)
			return
		}
		// Clean URL path and prevent traversal; treat directories as index fallback.
		cleanURL := path.Clean("/" + p) // ensure leading slash for consistent cleaning
		rel := strings.TrimPrefix(cleanURL, "/")
		if rel == "" || rel == "." || strings.Contains(rel, "..") {
			http.ServeFile(w, r, indexPath)
			return
		}
		full := filepath.Join(staticDir, filepath.FromSlash(rel))
		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			// Ensure the file server sees a clean, rooted path.
			r.URL.Path = "/" + rel
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, indexPath)
	}), nil
}
