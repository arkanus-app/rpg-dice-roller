package dicecore

import "container/list"

type LruCacheStats struct {
	Entries   int64
	Weight    int64
	Hits      int64
	Misses    int64
	Evictions int64
}

type weightedCacheEntry[K comparable, V any] struct {
	key    K
	value  V
	weight int64
}

// WeightedLruCache is owned by its caller; Engine serializes access to its caches.
type WeightedLruCache[K comparable, V any] struct {
	maxEntries, maxWeight int64
	entries               map[K]*list.Element
	order                 list.List
	stats                 LruCacheStats
}

func NewWeightedLruCache[K comparable, V any](maxEntries, maxWeight int64) *WeightedLruCache[K, V] {
	return &WeightedLruCache[K, V]{maxEntries: maxEntries, maxWeight: maxWeight, entries: make(map[K]*list.Element)}
}

func (c *WeightedLruCache[K, V]) Get(key K) (V, bool) {
	element, ok := c.entries[key]
	if !ok {
		c.stats.Misses++
		var zero V
		return zero, false
	}
	c.stats.Hits++
	c.order.MoveToBack(element)
	return element.Value.(weightedCacheEntry[K, V]).value, true
}

func (c *WeightedLruCache[K, V]) Set(key K, value V, weights ...int64) {
	weight := int64(1)
	if len(weights) > 0 {
		weight = weights[0]
	}
	if previous, ok := c.entries[key]; ok {
		c.stats.Weight -= previous.Value.(weightedCacheEntry[K, V]).weight
		c.order.Remove(previous)
		delete(c.entries, key)
	}
	if c.maxEntries == 0 || c.maxWeight == 0 || weight > c.maxWeight {
		return
	}
	c.entries[key] = c.order.PushBack(weightedCacheEntry[K, V]{key, value, weight})
	c.stats.Weight += weight
	for int64(len(c.entries)) > c.maxEntries || c.stats.Weight > c.maxWeight {
		oldest := c.order.Front()
		if oldest == nil {
			return
		}
		entry := oldest.Value.(weightedCacheEntry[K, V])
		delete(c.entries, entry.key)
		c.order.Remove(oldest)
		c.stats.Weight -= entry.weight
		c.stats.Evictions++
	}
}

func (c *WeightedLruCache[K, V]) Clear() {
	c.entries = make(map[K]*list.Element)
	c.order.Init()
	c.stats = LruCacheStats{}
}

func (c *WeightedLruCache[K, V]) Stats() LruCacheStats {
	stats := c.stats
	stats.Entries = int64(len(c.entries))
	return stats
}
