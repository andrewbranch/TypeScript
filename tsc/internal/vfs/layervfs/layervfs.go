// Package layervfs composes filesystem layers over a base filesystem.
package layervfs

import "github.com/microsoft/TypeScript/tsc/internal/vfs"

// Layer adds filesystem behavior over a base filesystem.
type Layer interface {
	Mount(base vfs.FS) vfs.FS
	Shadows(path string) bool
	Full() bool
}

// New creates a filesystem from layers ordered from highest to lowest priority.
func New(base vfs.FS, layers ...Layer) vfs.FS {
	result := base
	for i := len(layers) - 1; i >= 0; i-- {
		if layers[i] != nil {
			result = layers[i].Mount(result)
		}
	}
	return result
}
