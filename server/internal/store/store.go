package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"eendraadschema-share-server/internal/config"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type UserModel struct {
	Sub        string `gorm:"column:sub;primaryKey"`
	Email      string `gorm:"column:email"`
	Name       string `gorm:"column:name"`
	IsAdmin    bool   `gorm:"column:is_admin;not null;default:false;index"`
	CreatedAt  int64  `gorm:"column:created_at;not null;index"`
	UpdatedAt  int64  `gorm:"column:updated_at;not null;index"`
	// LastSeenAt is used as the "last login" timestamp.
	LastSeenAt int64 `gorm:"column:last_seen_at;not null;index"`
}

func (UserModel) TableName() string { return "users" }

type Store struct {
	db    *gorm.DB
	sqlDB *sql.DB
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
		db  *gorm.DB
		err error
	)

	switch driver {
	case "sqlite":
		if strings.TrimSpace(cfg.DBPath) == "" {
			return nil, fmt.Errorf("EDS_SHARE_DB is required when EDS_SHARE_DB_DRIVER=sqlite")
		}
		db, err = gorm.Open(sqlite.Open(cfg.DBPath), &gorm.Config{})
	case "postgres":
		if strings.TrimSpace(cfg.PostgresDSN) == "" {
			return nil, fmt.Errorf("EDS_SHARE_DB_DSN is required when EDS_SHARE_DB_DRIVER=postgres")
		}
		db, err = gorm.Open(postgres.Open(cfg.PostgresDSN), &gorm.Config{})
	default:
		return nil, fmt.Errorf("unsupported db driver: %q (use sqlite or postgres)", cfg.DBDriver)
	}
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	st := &Store{db: db, sqlDB: sqlDB}
	if err := st.migrate(context.Background()); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	return st, nil
}

func (s *Store) Close() error { return s.sqlDB.Close() }

func (s *Store) UpsertOIDCUser(ctx context.Context, sub string, email string, name string, now time.Time) error {
	sub = strings.TrimSpace(sub)
	if sub == "" {
		return fmt.Errorf("user sub is required")
	}
	nowUnix := now.Unix()

	// 1) Create the user if we don't know them yet.
	// 2) If they already exist, only update last login timestamp (do not overwrite admin/email/name).
	create := UserModel{
		Sub:        sub,
		Email:      strings.TrimSpace(email),
		Name:       strings.TrimSpace(name),
		IsAdmin:    false,
		CreatedAt:  nowUnix,
		UpdatedAt:  nowUnix,
		LastSeenAt: nowUnix,
	}
	if err := s.db.WithContext(ctx).
		Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "sub"}}, DoNothing: true}).
		Create(&create).Error; err != nil {
		return err
	}

	// Always bump last login for the (now known) user.
	return s.db.WithContext(ctx).
		Model(&UserModel{}).
		Where("sub = ?", sub).
		Updates(map[string]any{"last_seen_at": nowUnix, "updated_at": nowUnix}).Error
}

type ShareModel struct {
	ID       string         `gorm:"column:id;primaryKey"`
	Schema   string         `gorm:"column:schema;not null"`
	OwnerSub string         `gorm:"column:owner_sub;index"`
	TeamID   sql.NullString `gorm:"column:team_id;index"`
	CreatedAt int64         `gorm:"column:created_at;not null"`
	UpdatedAt int64         `gorm:"column:updated_at;not null"`
}

func (ShareModel) TableName() string { return "shares" }

type ShareVersionModel struct {
	ID         string `gorm:"column:id;primaryKey"`
	ShareID    string `gorm:"column:share_id;not null;index"`
	Schema     string `gorm:"column:schema;not null"`
	CreatedAt  int64  `gorm:"column:created_at;not null;index"`
	CreatedBySub string `gorm:"column:created_by_sub;index"`
}

func (ShareVersionModel) TableName() string { return "share_versions" }

type SessionModel struct {
	Token     string `gorm:"column:token;primaryKey"`
	ShareID   string `gorm:"column:share_id;not null;index"`
	ExpiresAt int64  `gorm:"column:expires_at;not null;index"`
	CreatedAt int64  `gorm:"column:created_at;not null"`
}

func (SessionModel) TableName() string { return "sessions" }

type TeamModel struct {
	ID       string `gorm:"column:id;primaryKey"`
	Name     string `gorm:"column:name;not null"`
	OwnerSub string `gorm:"column:owner_sub;not null"`
	CreatedAt int64 `gorm:"column:created_at;not null"`
}

func (TeamModel) TableName() string { return "teams" }

type TeamMemberModel struct {
	TeamID    string `gorm:"column:team_id;primaryKey"`
	UserSub   string `gorm:"column:user_sub;primaryKey;index"`
	Role      string `gorm:"column:role;not null"`
	CreatedAt int64  `gorm:"column:created_at;not null"`
}

func (TeamMemberModel) TableName() string { return "team_members" }

type TeamInviteModel struct {
	Token        string         `gorm:"column:token;primaryKey"`
	TeamID       string         `gorm:"column:team_id;not null;index"`
	Email        string         `gorm:"column:email"`
	CreatedBySub string         `gorm:"column:created_by_sub;not null"`
	CreatedAt    int64          `gorm:"column:created_at;not null"`
	ExpiresAt    int64          `gorm:"column:expires_at;not null"`
	AcceptedBySub sql.NullString `gorm:"column:accepted_by_sub"`
	AcceptedAt    sql.NullInt64  `gorm:"column:accepted_at"`
}

func (TeamInviteModel) TableName() string { return "team_invites" }

func (s *Store) migrate(ctx context.Context) error {
	// SQLite pragmas.
	if s.db.Dialector != nil && s.db.Dialector.Name() == "sqlite" {
		if err := s.db.WithContext(ctx).Exec(`PRAGMA foreign_keys=ON;`).Error; err != nil {
			return err
		}
		_ = s.db.WithContext(ctx).Exec(`PRAGMA journal_mode=WAL;`).Error
	}

	// Ensure base tables exist.
	if err := s.db.WithContext(ctx).AutoMigrate(&UserModel{}, &ShareModel{}, &ShareVersionModel{}, &SessionModel{}, &TeamModel{}, &TeamMemberModel{}, &TeamInviteModel{}); err != nil {
		return err
	}
	return nil
}



type Share struct {
	ID        string
	Schema    string
	OwnerSub  string
	TeamID    sql.NullString
	CreatedAt time.Time
	UpdatedAt time.Time
}

type ShareSummary struct {
	ID        string
	TeamID    sql.NullString
	CreatedAt time.Time
	UpdatedAt time.Time
}

type ShareAdminSummary struct {
	ID        string
	OwnerSub  string
	TeamID    sql.NullString
	CreatedAt time.Time
	UpdatedAt time.Time
}

type ShareVersionSummary struct {
	ID        string
	CreatedAt time.Time
	CreatedBySub string
}

type Team struct {
	ID        string
	Name      string
	OwnerSub  string
	CreatedAt time.Time
}

type TeamWithRole struct {
	ID   string
	Name string
	Role string
}

type User struct {
	Sub        string
	Email      string
	Name       string
	IsAdmin    bool
	CreatedAt  time.Time
	UpdatedAt  time.Time
	LastSeenAt time.Time
}

var ErrNotFound = errors.New("not found")

func (s *Store) IsUserAdmin(ctx context.Context, sub string) (bool, error) {
	sub = strings.TrimSpace(sub)
	if sub == "" {
		return false, nil
	}
	var row UserModel
	err := s.db.WithContext(ctx).Select("sub", "is_admin").Where("sub = ?", sub).Take(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return row.IsAdmin, nil
}

func (s *Store) SetUserAdmin(ctx context.Context, sub string, isAdmin bool, now time.Time) error {
	sub = strings.TrimSpace(sub)
	if sub == "" {
		return fmt.Errorf("user sub is required")
	}
	res := s.db.WithContext(ctx).
		Model(&UserModel{}).
		Where("sub = ?", sub).
		Updates(map[string]any{"is_admin": isAdmin, "updated_at": now.Unix()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListUsers(ctx context.Context, query string, limit int) ([]User, error) {
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	q := strings.ToLower(strings.TrimSpace(query))
	like := "%" + q + "%"

	var rows []UserModel
	db := s.db.WithContext(ctx).Model(&UserModel{})
	if q != "" {
		db = db.Where(
			"lower(sub) LIKE ? OR lower(email) LIKE ? OR lower(name) LIKE ?",
			like,
			like,
			like,
		)
	}
	if err := db.Order("last_seen_at desc").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]User, 0, len(rows))
	for _, r := range rows {
		out = append(out, User{
			Sub:        r.Sub,
			Email:      r.Email,
			Name:       r.Name,
			IsAdmin:    r.IsAdmin,
			CreatedAt:  time.Unix(r.CreatedAt, 0),
			UpdatedAt:  time.Unix(r.UpdatedAt, 0),
			LastSeenAt: time.Unix(r.LastSeenAt, 0),
		})
	}
	return out, nil
}

func (s *Store) GetUsersBySubs(ctx context.Context, subs []string) (map[string]User, error) {
	uniq := make([]string, 0, len(subs))
	seen := map[string]bool{}
	for _, s := range subs {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		uniq = append(uniq, s)
	}
	if len(uniq) == 0 {
		return map[string]User{}, nil
	}

	var rows []UserModel
	if err := s.db.WithContext(ctx).
		Model(&UserModel{}).
		Where("sub IN ?", uniq).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]User, len(rows))
	for _, r := range rows {
		out[r.Sub] = User{
			Sub:        r.Sub,
			Email:      r.Email,
			Name:       r.Name,
			IsAdmin:    r.IsAdmin,
			CreatedAt:  time.Unix(r.CreatedAt, 0),
			UpdatedAt:  time.Unix(r.UpdatedAt, 0),
			LastSeenAt: time.Unix(r.LastSeenAt, 0),
		}
	}
	return out, nil
}

func (s *Store) CreateShare(ctx context.Context, id string, schema string, ownerSub string, teamID *string, now time.Time) error {
	m := ShareModel{
		ID:        id,
		Schema:    schema,
		OwnerSub:  strings.TrimSpace(ownerSub),
		CreatedAt: now.Unix(),
		UpdatedAt: now.Unix(),
	}
	if teamID != nil && strings.TrimSpace(*teamID) != "" {
		m.TeamID = sql.NullString{String: strings.TrimSpace(*teamID), Valid: true}
	}
	return s.db.WithContext(ctx).Create(&m).Error
}

func (s *Store) UpdateShare(ctx context.Context, id string, schema string, now time.Time) error {
	res := s.db.WithContext(ctx).
		Model(&ShareModel{}).
		Where("id = ?", id).
		Updates(map[string]any{"schema": schema, "updated_at": now.Unix()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) GetShare(ctx context.Context, id string) (Share, error) {
	var m ShareModel
	if err := s.db.WithContext(ctx).First(&m, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return Share{}, ErrNotFound
		}
		return Share{}, err
	}
	return Share{
		ID:        m.ID,
		Schema:    m.Schema,
		OwnerSub:  m.OwnerSub,
		TeamID:    m.TeamID,
		CreatedAt: time.Unix(m.CreatedAt, 0),
		UpdatedAt: time.Unix(m.UpdatedAt, 0),
	}, nil
}

func (s *Store) AddShareVersion(ctx context.Context, versionID string, shareID string, schema string, createdBySub string, now time.Time) error {
	shareID = strings.TrimSpace(shareID)
	if shareID == "" {
		return fmt.Errorf("shareID is required")
	}
	m := ShareVersionModel{
		ID:          strings.TrimSpace(versionID),
		ShareID:     shareID,
		Schema:      schema,
		CreatedAt:   now.Unix(),
		CreatedBySub: strings.TrimSpace(createdBySub),
	}
	return s.db.WithContext(ctx).Create(&m).Error
}

func (s *Store) ListShareVersions(ctx context.Context, shareID string, limit int) ([]ShareVersionSummary, error) {
	shareID = strings.TrimSpace(shareID)
	if shareID == "" {
		return nil, fmt.Errorf("shareID is required")
	}
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	var rows []ShareVersionModel
	if err := s.db.WithContext(ctx).
		Select("id", "created_at", "created_by_sub").
		Where("share_id = ?", shareID).
		Order("created_at DESC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]ShareVersionSummary, 0, len(rows))
	for _, r := range rows {
		out = append(out, ShareVersionSummary{ID: r.ID, CreatedAt: time.Unix(r.CreatedAt, 0), CreatedBySub: r.CreatedBySub})
	}
	return out, nil
}

func (s *Store) GetShareVersion(ctx context.Context, shareID string, versionID string) (string, error) {
	shareID = strings.TrimSpace(shareID)
	versionID = strings.TrimSpace(versionID)
	if shareID == "" || versionID == "" {
		return "", fmt.Errorf("shareID and versionID are required")
	}
	var m ShareVersionModel
	if err := s.db.WithContext(ctx).First(&m, "id = ? AND share_id = ?", versionID, shareID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", ErrNotFound
		}
		return "", err
	}
	return m.Schema, nil
}

func (s *Store) PruneShareVersions(ctx context.Context, shareID string, keep int) error {
	shareID = strings.TrimSpace(shareID)
	if shareID == "" {
		return fmt.Errorf("shareID is required")
	}
	if keep <= 0 {
		return nil
	}
	// Delete everything beyond the newest `keep` versions, in chunks.
	for {
		var oldRows []ShareVersionModel
		if err := s.db.WithContext(ctx).
			Select("id").
			Where("share_id = ?", shareID).
			Order("created_at DESC").
			Offset(keep).
			Limit(500).
			Find(&oldRows).Error; err != nil {
			return err
		}
		if len(oldRows) == 0 {
			return nil
		}
		ids := make([]string, 0, len(oldRows))
		for _, r := range oldRows {
			ids = append(ids, r.ID)
		}
		if err := s.db.WithContext(ctx).Where("id IN ?", ids).Delete(&ShareVersionModel{}).Error; err != nil {
			return err
		}
	}
}

func (s *Store) ListSharesByOwner(ctx context.Context, ownerSub string, limit int) ([]ShareSummary, error) {
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	var rows []ShareModel
	if err := s.db.WithContext(ctx).
		Select("id", "team_id", "created_at", "updated_at").
		Where("owner_sub = ?", strings.TrimSpace(ownerSub)).
		Order("updated_at DESC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]ShareSummary, 0, len(rows))
	for _, r := range rows {
		out = append(out, ShareSummary{ID: r.ID, TeamID: r.TeamID, CreatedAt: time.Unix(r.CreatedAt, 0), UpdatedAt: time.Unix(r.UpdatedAt, 0)})
	}
	return out, nil
}

func (s *Store) ListAllShares(ctx context.Context, limit int) ([]ShareAdminSummary, error) {
	if limit <= 0 {
		limit = 500
	}
	if limit > 2000 {
		limit = 2000
	}

	var rows []ShareModel
	if err := s.db.WithContext(ctx).
		Model(&ShareModel{}).
		Select("id", "owner_sub", "team_id", "created_at", "updated_at").
		Order("updated_at desc").
		Limit(limit).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]ShareAdminSummary, 0, len(rows))
	for _, r := range rows {
		out = append(out, ShareAdminSummary{
			ID:        r.ID,
			OwnerSub:  r.OwnerSub,
			TeamID:    r.TeamID,
			CreatedAt: time.Unix(r.CreatedAt, 0),
			UpdatedAt: time.Unix(r.UpdatedAt, 0),
		})
	}
	return out, nil
}

func (s *Store) CreateTeam(ctx context.Context, id string, name string, ownerSub string, now time.Time) error {
	ownerSub = strings.TrimSpace(ownerSub)
	name = strings.TrimSpace(name)
	if ownerSub == "" {
		return fmt.Errorf("ownerSub is required")
	}
	if name == "" {
		return fmt.Errorf("team name is required")
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&TeamModel{ID: id, Name: name, OwnerSub: ownerSub, CreatedAt: now.Unix()}).Error; err != nil {
			return err
		}
		if err := tx.Create(&TeamMemberModel{TeamID: id, UserSub: ownerSub, Role: "owner", CreatedAt: now.Unix()}).Error; err != nil {
			return err
		}
		return nil
	})
}

func (s *Store) ListTeamsForUser(ctx context.Context, userSub string) ([]TeamWithRole, error) {
	userSub = strings.TrimSpace(userSub)
	type row struct {
		ID   string
		Name string
		Role string
	}
	var rows []row
	if err := s.db.WithContext(ctx).
		Table("team_members m").
		Select("t.id as id, t.name as name, m.role as role").
		Joins("JOIN teams t ON t.id = m.team_id").
		Where("m.user_sub = ?", userSub).
		Order("t.created_at DESC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]TeamWithRole, 0, len(rows))
	for _, r := range rows {
		out = append(out, TeamWithRole{ID: r.ID, Name: r.Name, Role: r.Role})
	}
	return out, nil
}

func (s *Store) IsTeamMember(ctx context.Context, teamID string, userSub string) (string, bool, error) {
	teamID = strings.TrimSpace(teamID)
	userSub = strings.TrimSpace(userSub)
	var m TeamMemberModel
	err := s.db.WithContext(ctx).
		Select("role").
		Where("team_id = ? AND user_sub = ?", teamID, userSub).
		First(&m).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", false, nil
		}
		return "", false, err
	}
	return m.Role, true, nil
}

func (s *Store) CreateTeamInvite(ctx context.Context, token string, teamID string, email string, createdBySub string, expiresAt time.Time, now time.Time) error {
	m := TeamInviteModel{
		Token:        token,
		TeamID:       strings.TrimSpace(teamID),
		Email:        strings.TrimSpace(email),
		CreatedBySub: strings.TrimSpace(createdBySub),
		CreatedAt:    now.Unix(),
		ExpiresAt:    expiresAt.Unix(),
	}
	return s.db.WithContext(ctx).Create(&m).Error
}

func (s *Store) AcceptTeamInvite(ctx context.Context, token string, acceptedBySub string, now time.Time) (string, error) {
	acceptedBySub = strings.TrimSpace(acceptedBySub)
	if acceptedBySub == "" {
		return "", fmt.Errorf("acceptedBySub is required")
	}

	var teamID string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var inv TeamInviteModel
		if err := tx.First(&inv, "token = ?", token).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}

		if inv.AcceptedAt.Valid {
			teamID = inv.TeamID
			return nil
		}
		if now.Unix() > inv.ExpiresAt {
			return ErrNotFound
		}

		res := tx.Model(&TeamInviteModel{}).
			Where("token = ? AND accepted_at IS NULL", token).
			Updates(map[string]any{
				"accepted_by_sub": sql.NullString{String: acceptedBySub, Valid: true},
				"accepted_at":     sql.NullInt64{Int64: now.Unix(), Valid: true},
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrNotFound
		}

		teamID = inv.TeamID
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "team_id"}, {Name: "user_sub"}}, DoNothing: true}).
			Create(&TeamMemberModel{TeamID: inv.TeamID, UserSub: acceptedBySub, Role: "member", CreatedAt: now.Unix()}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return "", ErrNotFound
		}
		return "", err
	}
	return teamID, nil
}

func (s *Store) CreateSession(ctx context.Context, token string, shareID string, expiresAt time.Time, now time.Time) error {
	m := SessionModel{Token: token, ShareID: shareID, ExpiresAt: expiresAt.Unix(), CreatedAt: now.Unix()}
	return s.db.WithContext(ctx).Create(&m).Error
}

func (s *Store) GetSessionShareID(ctx context.Context, token string, now time.Time) (string, error) {
	var m SessionModel
	if err := s.db.WithContext(ctx).First(&m, "token = ?", token).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", ErrNotFound
		}
		return "", err
	}
	if now.Unix() >= m.ExpiresAt {
		_ = s.db.WithContext(ctx).Delete(&SessionModel{}, "token = ?", token).Error
		return "", ErrNotFound
	}
	return m.ShareID, nil
}

func (s *Store) CleanupExpiredSessions(ctx context.Context, now time.Time) {
	_ = s.db.WithContext(ctx).Where("expires_at <= ?", now.Unix()).Delete(&SessionModel{}).Error
}

func (s *Store) HealthCheck(ctx context.Context) error {
	if err := s.sqlDB.PingContext(ctx); err != nil {
		return fmt.Errorf("db ping failed: %w", err)
	}
	return nil
}
