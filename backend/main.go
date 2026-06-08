// System Design course backend.
//
// A thin reader over the Markdown content tree (../content). No database:
// chapters are read from disk and cached in memory at startup.
//
//   GET /api/curriculum     -> levels -> modules -> chapters (metadata, ordered)
//   GET /api/chapters/:slug -> one chapter (metadata + raw markdown body)
//   GET /healthz            -> liveness
//
// Env:
//   CONTENT_DIR     path to the content tree   (default: ../content)
//   FRONTEND_DIST   if set, serve this static dir (built frontend) at /
//   PORT            listen port                (default: 8080)
//   CORS_ORIGINS    comma list for dev         (default: http://localhost:5173)
//   SD_WATCH        "0" disables content auto-reload (default: on)
//   SD_WATCH_MS     poll interval in ms        (default: 1000)
package main

import (
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"gopkg.in/yaml.v3"
)

// holder wraps the current store behind a RWMutex so the watcher can swap it
// while requests read it concurrently.
type holder struct {
	mu sync.RWMutex
	st *store
}

func (h *holder) get() *store {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.st
}

func (h *holder) set(st *store) {
	h.mu.Lock()
	h.st = st
	h.mu.Unlock()
}

// ChapterMeta is the frontmatter we expose to the app.
type ChapterMeta struct {
	Title         string   `yaml:"title" json:"title"`
	Slug          string   `yaml:"slug" json:"slug"`
	Level         string   `yaml:"level" json:"level"`
	Module        string   `yaml:"module" json:"module"`
	Order         int      `yaml:"order" json:"order"`
	ReadingMinute int      `yaml:"reading_time_min" json:"readingTimeMin"`
	Concepts      []string `yaml:"concepts" json:"concepts"`
	UseCases      []string `yaml:"use_cases" json:"useCases"`
	Prerequisites []string `yaml:"prerequisites" json:"prerequisites"`
	Status        string   `yaml:"status" json:"status"`
}

// Chapter is metadata plus the raw markdown body.
type Chapter struct {
	ChapterMeta
	Body string `json:"body"`
}

// store is the in-memory cache built once at startup.
type store struct {
	bySlug   map[string]Chapter
	ordered  []Chapter // sorted by level then order
}

func main() {
	contentDir := env("CONTENT_DIR", "../content")
	useCasesDir := env("USE_CASES_DIR", "../use-cases")
	dirs := []string{contentDir, useCasesDir}
	st, err := loadContent(dirs...)
	if err != nil {
		log.Fatalf("load content: %v", err)
	}
	log.Printf("loaded %d chapters from %v", len(st.ordered), dirs)

	h := &holder{st: st}

	// Auto-reload content on change (default on) so edits show up without a
	// restart. Polls the tree's fingerprint; reloads only when it changes.
	if env("SD_WATCH", "1") != "0" {
		ms, _ := strconv.Atoi(env("SD_WATCH_MS", "1000"))
		if ms <= 0 {
			ms = 1000
		}
		go watch(dirs, h, time.Duration(ms)*time.Millisecond)
		log.Printf("watching %v for changes (every %dms)", dirs, ms)
	}

	app := fiber.New(fiber.Config{AppName: "system-design"})
	app.Use(cors.New(cors.Config{
		AllowOrigins: env("CORS_ORIGINS", "http://localhost:5173"),
	}))

	app.Get("/healthz", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok", "chapters": len(h.get().ordered)})
	})

	app.Get("/api/curriculum", func(c *fiber.Ctx) error {
		return c.JSON(h.get().curriculum())
	})

	app.Get("/api/chapters/:slug", func(c *fiber.Ctx) error {
		ch, ok := h.get().bySlug[c.Params("slug")]
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "chapter not found"})
		}
		return c.JSON(ch)
	})

	if dist := os.Getenv("FRONTEND_DIST"); dist != "" {
		app.Static("/", dist)
		// SPA fallback: client-side routes (e.g. /learn/:slug) have no file on
		// disk, so serve index.html for any non-API GET that didn't match.
		app.Get("/*", func(c *fiber.Ctx) error {
			if strings.HasPrefix(c.Path(), "/api") {
				return c.SendStatus(fiber.StatusNotFound)
			}
			return c.SendFile(filepath.Join(dist, "index.html"))
		})
	}

	addr := ":" + env("PORT", "8080")
	log.Printf("listening on %s", addr)
	log.Fatal(app.Listen(addr))
}

// watch polls the content tree and swaps in a freshly-loaded store whenever the
// fingerprint (file set + sizes + mtimes) changes.
func watch(dirs []string, h *holder, interval time.Duration) {
	last := fingerprint(dirs...)
	for range time.Tick(interval) {
		fp := fingerprint(dirs...)
		if fp == last {
			continue
		}
		last = fp
		st, err := loadContent(dirs...)
		if err != nil {
			log.Printf("reload failed: %v", err)
			continue
		}
		h.set(st)
		log.Printf("content reloaded: %d chapters", len(st.ordered))
	}
}

// fingerprint is a cheap signature of the markdown tree: it changes whenever any
// .md file is added, removed, resized, or modified.
func fingerprint(dirs ...string) string {
	var b strings.Builder
	for _, dir := range dirs {
		_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".md") {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			b.WriteString(path)
			b.WriteByte(':')
			b.WriteString(strconv.FormatInt(info.Size(), 10))
			b.WriteByte(':')
			b.WriteString(strconv.FormatInt(info.ModTime().UnixNano(), 10))
			b.WriteByte('\n')
			return nil
		})
	}
	return b.String()
}

// --- curriculum shaping -----------------------------------------------------

type moduleNode struct {
	Module   string        `json:"module"`
	Chapters []ChapterMeta `json:"chapters"`
}

type levelNode struct {
	Level   string       `json:"level"`
	Modules []moduleNode `json:"modules"`
}

func (s *store) curriculum() []levelNode {
	// preserve first-seen order of levels and modules from the ordered slice
	levelOrder := []string{}
	levels := map[string]map[string]*moduleNode{}
	moduleOrder := map[string][]string{}

	for _, ch := range s.ordered {
		if _, ok := levels[ch.Level]; !ok {
			levels[ch.Level] = map[string]*moduleNode{}
			levelOrder = append(levelOrder, ch.Level)
		}
		if _, ok := levels[ch.Level][ch.Module]; !ok {
			levels[ch.Level][ch.Module] = &moduleNode{Module: ch.Module}
			moduleOrder[ch.Level] = append(moduleOrder[ch.Level], ch.Module)
		}
		mn := levels[ch.Level][ch.Module]
		mn.Chapters = append(mn.Chapters, ch.ChapterMeta)
	}

	out := []levelNode{}
	for _, lvl := range levelOrder {
		ln := levelNode{Level: lvl}
		for _, mod := range moduleOrder[lvl] {
			ln.Modules = append(ln.Modules, *levels[lvl][mod])
		}
		out = append(out, ln)
	}
	return out
}

// --- loading ----------------------------------------------------------------

func loadContent(dirs ...string) (*store, error) {
	st := &store{bySlug: map[string]Chapter{}}
	for _, dir := range dirs {
		err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(path, ".md") {
				return nil
			}
			base := strings.ToLower(filepath.Base(path))
			if base == "readme.md" || base == "catalog.md" {
				return nil
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			meta, body, ok := parseFrontmatter(raw)
			if !ok || meta.Slug == "" {
				log.Printf("skip %s: missing/invalid frontmatter", path)
				return nil
			}
			st.bySlug[meta.Slug] = Chapter{ChapterMeta: meta, Body: body}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	for _, ch := range st.bySlug {
		st.ordered = append(st.ordered, ch)
	}
	sort.Slice(st.ordered, func(i, j int) bool {
		ri, rj := levelRank(st.ordered[i].Level), levelRank(st.ordered[j].Level)
		if ri != rj {
			return ri < rj
		}
		return st.ordered[i].Order < st.ordered[j].Order
	})
	return st, nil
}

// levelRank orders levels Foundations → Intermediate → Advanced → Use Cases (not alphabetical).
func levelRank(level string) int {
	switch level {
	case "foundations":
		return 0
	case "intermediate":
		return 1
	case "advanced":
		return 2
	case "use-cases":
		return 3
	default:
		return 99
	}
}

// parseFrontmatter splits a `--- yaml --- body` document.
func parseFrontmatter(raw []byte) (ChapterMeta, string, bool) {
	s := string(raw)
	if !strings.HasPrefix(s, "---") {
		return ChapterMeta{}, "", false
	}
	rest := s[3:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return ChapterMeta{}, "", false
	}
	fm := rest[:end]
	body := rest[end+len("\n---"):]
	body = strings.TrimPrefix(body, "\n")

	var meta ChapterMeta
	if err := yaml.Unmarshal([]byte(fm), &meta); err != nil {
		return ChapterMeta{}, "", false
	}
	return meta, strings.TrimLeft(body, "\n"), true
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
