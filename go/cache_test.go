package dicecore

import "testing"

func TestWeightedCacheEvictionAndPromotion(t *testing.T) {
	c := NewWeightedLruCache[string, int](2, 10)
	c.Set("first", 1)
	c.Set("second", 2)
	if v, ok := c.Get("first"); !ok || v != 1 {
		t.Fatal(v, ok)
	}
	c.Set("third", 3)
	if _, ok := c.Get("second"); ok {
		t.Fatal("least recent entry retained")
	}
	c.Set("third", 30, 2)
	if v, ok := c.Get("third"); !ok || v != 30 {
		t.Fatal(v, ok)
	}
	if got := c.Stats(); got.Entries != 2 || got.Weight != 3 || got.Hits != 2 || got.Misses != 1 || got.Evictions != 1 {
		t.Fatal(got)
	}
	c.Clear()
	if got := c.Stats(); got != (LruCacheStats{}) {
		t.Fatal(got)
	}
}

func TestWeightedCacheCaps(t *testing.T) {
	c := NewWeightedLruCache[string, int](10, 4)
	c.Set("first", 1, 3)
	c.Set("second", 2, 2)
	if _, ok := c.Get("first"); ok {
		t.Fatal("weight cap ignored")
	}
	c.Set("oversized", 3, 5)
	if _, ok := c.Get("oversized"); ok {
		t.Fatal("oversized entry retained")
	}
	c.Set("second", 4, 5)
	if got := c.Stats(); got.Entries != 0 || got.Weight != 0 || got.Evictions != 1 {
		t.Fatal(got)
	}
	for _, caps := range [][2]int64{{0, 1}, {1, 0}, {-1, 1}, {1, -1}} {
		cache := NewWeightedLruCache[string, int](caps[0], caps[1])
		cache.Set("x", 1)
		if got := cache.Stats(); got.Entries != 0 || got.Weight != 0 {
			t.Fatal(got)
		}
	}
}
