package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"eendraadschema-share-server/internal/config"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

type Store struct {
	db     *sql.DB
	driver string
}

func Open(cfg config.Config) (*Store, error) {
	driver := strings.ToLower(strings.TrimSpace(cfg.DBDriver))
	if driver == "" {
		driver = "sqlite"
	}
	if driver == "postgresql" || driver == "pg" {
		driver = "postgres"
	}

	var (
		db  *sql.DB
		err error
	)

	switch driver {
	case "sqlite":
		db, err = sql.Open("sqlite", cfg.DBPath)
		if err != nil {
			return nil, err
		}
		// Pragmas tuned for small server; safe enough.
		if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`); err != nil {
			_ = db.Close()
			return nil, err
		}
	case "postgres":
		if strings.TrimSpace(cfg.PostgresDSN) == "" {
			return nil, fmt.Errorf("EDS_SHARE_DB_DSN is required when EDS_SHARE_DB_DRIVER=postgres")
		}
		db, err = sql.Open("pgx", cfg.PostgresDSN)
		if err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unsupported db driver: %q (use sqlite or postgres)", cfg.DBDriver)
	}

	if err != nil {
		return nil, err
	}

	st := &Store{db: db, driver: driver}
	if err := st.initSchema(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return st, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) initSchema(ctx context.Context) error {
	var stmts []string
	switch s.driver {
	case "sqlite":
		stmts = []string{
			`CREATE TABLE IF NOT EXISTS shares (
				id TEXT PRIMARY KEY,
				schema TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);`,
			`CREATE TABLE IF NOT EXISTS sessions (
				token TEXT PRIMARY KEY,
				share_id TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				FOREIGN KEY(share_id) REFERENCES shares(id) ON DELETE CASCADE
			);`,
			`CREATE INDEX IF NOT EXISTS idx_sessions_share_id ON sessions(share_id);`,
			`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);`,
		}
	case "postgres":
		stmts = []string{
			`CREATE TABLE IF NOT EXISTS shares (
				id TEXT PRIMARY KEY,
				schema TEXT NOT NULL,
				created_at BIGINT NOT NULL,
				updated_at BIGINT NOT NULL
			);`,
			`CREATE TABLE IF NOT EXISTS sessions (
				token TEXT PRIMARY KEY,
				share_id TEXT NOT NULL,
				expires_at BIGINT NOT NULL,
				created_at BIGINT NOT NULL,
				FOREIGN KEY(share_id) REFERENCES shares(id) ON DELETE CASCADE
			);`,
			`CREATE INDEX IF NOT EXISTS idx_sessions_share_id ON sessions(share_id);`,
			`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);`,
		}
	default:
		return fmt.Errorf("unsupported driver in store: %q", s.driver)
	}
	for _, stmt := range stmts {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

type Share struct {
	ID        string
	Schema    string
	CreatedAt time.Time
	UpdatedAt time.Time
}

var ErrNotFound = errors.New("not found")

func (s *Store) CreateShare(ctx context.Context, id string, schema string, now time.Time) error {
	var q string
	switch s.driver {
	case "sqlite":
		q = `INSERT INTO shares(id, schema, created_at, updated_at) VALUES(?, ?, ?, ?);`
	case "postgres":
		q = `INSERT INTO shares(id, schema, created_at, updated_at) VALUES($1, $2, $3, $4);`
	default:
		return fmt.Errorf("unsupported driver: %q", s.driver)
	}
	_, err := s.db.ExecContext(ctx, q, id, schema, now.Unix(), now.Unix())
	return err
}

func (s *Store) UpdateShare(ctx context.Context, id string, schema string, now time.Time) error {
	var q string
	switch s.driver {
	case "sqlite":
		q = `UPDATE shares SET schema = ?, updated_at = ? WHERE id = ?;`
	case "postgres":
		q = `UPDATE shares SET schema = $1, updated_at = $2 WHERE id = $3;`
	default:
		return fmt.Errorf("unsupported driver: %q", s.driver)
	}
	res, err := s.db.ExecContext(ctx, q, schema, now.Unix(), id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) GetShare(ctx context.Context, id string) (Share, error) {
	var q string
	switch s.driver {
	case "sqlite":
		q = `SELECT id, schema, created_at, updated_at FROM shares WHERE id = ?;`
	case "postgres":
		q = `SELECT id, schema, created_at, updated_at FROM shares WHERE id = $1;`
	default:
		return Share{}, fmt.Errorf("unsupported driver: %q", s.driver)
	}
	row := s.db.QueryRowContext(ctx, q, id)
	var sh Share
	var createdUnix, updatedUnix int64
	if err := row.Scan(&sh.ID, &sh.Schema, &createdUnix, &updatedUnix); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Share{}, ErrNotFound
		}
		return Share{}, err
	}
	sh.CreatedAt = time.Unix(createdUnix, 0)
	sh.UpdatedAt = time.Unix(updatedUnix, 0)
	return sh, nil
}

func (s *Store) CreateSession(ctx context.Context, token string, shareID string, expiresAt time.Time, now time.Time) error {
	var q string
	switch s.driver {
	case "sqlite":
		q = `INSERT INTO sessions(token, share_id, expires_at, created_at) VALUES(?, ?, ?, ?);`
	case "postgres":
		q = `INSERT INTO sessions(token, share_id, expires_at, created_at) VALUES($1, $2, $3, $4);`
	default:
		return fmt.Errorf("unsupported driver: %q", s.driver)
	}
	_, err := s.db.ExecContext(ctx, q, token, shareID, expiresAt.Unix(), now.Unix())
	return err
}

func (s *Store) GetSessionShareID(ctx context.Context, token string, now time.Time) (string, error) {
	var q string
	switch s.driver {
	case "sqlite":
		q = `SELECT share_id, expires_at FROM sessions WHERE token = ?;`
	case "postgres":
		q = `SELECT share_id, expires_at FROM sessions WHERE token = $1;`
	default:
		return "", fmt.Errorf("unsupported driver: %q", s.driver)
	}
	row := s.db.QueryRowContext(ctx, q, token)
	var shareID string
	var expiresUnix int64
	if err := row.Scan(&shareID, &expiresUnix); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	if now.Unix() >= expiresUnix {
		// best-effort cleanup
		switch s.driver {
		case "sqlite":
			_, _ = s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token = ?;`, token)
		case "postgres":
			_, _ = s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token = $1;`, token)
		}
		return "", ErrNotFound
	}
	return shareID, nil
}

func (s *Store) CleanupExpiredSessions(ctx context.Context, now time.Time) {
	switch s.driver {
	case "sqlite":
		_, _ = s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?;`, now.Unix())
	case "postgres":
		_, _ = s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= $1;`, now.Unix())
	}
}

func (s *Store) HealthCheck(ctx context.Context) error {
	var x int
	if err := s.db.QueryRowContext(ctx, `SELECT 1;`).Scan(&x); err != nil {
		return fmt.Errorf("db ping failed: %w", err)
	}
	return nil
}
