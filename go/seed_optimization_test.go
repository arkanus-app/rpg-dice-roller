package dicecore

import (
	"strconv"
	"strings"
	"testing"
	"unicode/utf16"
)

func originalSeedHash(units []uint16) [4]uint32 {
	hash := uint32(1779033703) ^ uint32(len(units))
	for _, unit := range units {
		hash = (hash ^ uint32(unit)) * 3432918353
		hash = hash<<13 | hash>>19
	}
	var words [4]uint32
	for i := range words {
		hash = (hash ^ (hash >> 16)) * 2246822507
		hash = (hash ^ (hash >> 13)) * 3266489909
		hash ^= hash >> 16
		words[i] = hash
	}
	return words
}

func TestSeedStreamingHashMatchesUTF16Reference(t *testing.T) {
	inputs := []any{"", "\x00", "🎲ação", "\uffff\U00010000\U0010ffff", strings.Repeat("🎲", 512),
		strings.Repeat("a", 1024), strings.Repeat("é", 1024), UTF16Seed(nil), UTF16Seed{},
		UTF16Seed{0xd800}, UTF16Seed{0xdc00}, UTF16Seed{0xd800, 0xd800, 0xdc00},
		UTF16Seed{0, 0xd83c, 0xdfb2, 0xffff}, 1e-7, 1e21}
	for index := range 1000 {
		inputs = append(inputs, "request/🎲/"+strconv.Itoa(index))
	}
	for _, input := range inputs {
		seed, err := CreateProvidedSeed(input)
		if err != nil {
			t.Fatal(err)
		}
		var units []uint16
		if explicit, ok := input.(UTF16Seed); ok {
			units = append(utf16.Encode([]rune("string:")), explicit...)
		} else {
			units = utf16.Encode([]rune(seed.CanonicalSeed))
		}
		if want := originalSeedHash(units); seed.Words != want {
			t.Fatalf("seed %v: words %v, want %v", input, seed.Words, want)
		}
	}
}
