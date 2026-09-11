package layervfs

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/wrapvfs"
	"gotest.tools/v3/assert"
)

type testLayer map[string]string

func (l testLayer) Mount(base vfs.FS) vfs.FS {
	return wrapvfs.Wrap(base, wrapvfs.Replacements{
		FileExists: func(path string) bool {
			if _, ok := l[path]; ok {
				return true
			}
			return base.FileExists(path)
		},
		ReadFile: func(path string) (string, bool) {
			if content, ok := l[path]; ok {
				return content, true
			}
			return base.ReadFile(path)
		},
	})
}

func (l testLayer) Shadows(path string) bool {
	_, ok := l[path]
	return ok
}

func TestNew(t *testing.T) {
	t.Parallel()

	base := vfstest.FromMap(map[string]string{
		"/base.ts":   "base",
		"/shared.ts": "base",
	}, true)
	fsys := New(
		base,
		testLayer{"/top.ts": "top", "/shared.ts": "top"},
		testLayer{"/middle.ts": "middle", "/shared.ts": "middle"},
	)

	for path, expected := range map[string]string{
		"/base.ts":   "base",
		"/middle.ts": "middle",
		"/top.ts":    "top",
		"/shared.ts": "top",
	} {
		content, ok := fsys.ReadFile(path)
		assert.Assert(t, ok, path)
		assert.Equal(t, content, expected)
	}
}
