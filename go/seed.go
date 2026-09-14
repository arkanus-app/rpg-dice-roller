package dicecore

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// SeedOrigin distinguishes identical textual and numeric user seeds.
type SeedOrigin string

const (
	SeedProvidedNumber SeedOrigin = "provided-number"
	SeedProvidedString SeedOrigin = "provided-string"
	SeedCrypto         SeedOrigin = "crypto"
)

// UTF16Seed is the explicit representation of a JS string containing unpaired
// surrogates. Normal UTF-8 strings need no wrapper.
type UTF16Seed []uint16

// SeedMaterial holds a fixed 128-bit seed. Only SeedMaterial and Origin appear
// in replay; the user seed text and generator words are never serialized.
// CanonicalSeed renders unpaired UTF16Seed surrogates as replacement characters;
// the hash always uses the original code units without that replacement.
type SeedMaterial struct {
	CanonicalSeed string     `json:"-"`
	SeedMaterial  string     `json:"seedMaterial"`
	Origin        SeedOrigin `json:"origin"`
	Words         [4]uint32  `json:"-"`
}

// CanonicalizeSeed accepts string, UTF16Seed, float64, and native integer values.
// Integers must be exactly representable as JS safe integers; callers wanting
// the semantics of a larger JS Number must pass its float64 representation.
// The optional text limit defaults to the TypeScript engine's 1024 UTF-16 units.
func CanonicalizeSeed(seed any, maxSeedLength ...int64) (string, error) {
	canonical, err := canonicalSeedData(seed, maxSeedLength)
	return canonical.text, err
}

type canonicalSeed struct {
	text          string
	length        int
	origin        SeedOrigin
	explicitUnits UTF16Seed
}

func canonicalSeedData(seed any, limits []int64) (canonicalSeed, error) {
	limit := int64(1024)
	if len(limits) > 1 {
		return canonicalSeed{}, newDiceError("INVALID_LIMIT", "Only one maxSeedLength may be provided", "", nil)
	}
	if len(limits) == 1 {
		limit = limits[0]
	}
	if limit < 1 || limit > randomMaxSafeInteger {
		return canonicalSeed{}, newDiceError("INVALID_LIMIT", "maxSeedLength must be a positive safe integer", "", map[string]any{"maxSeedLength": limit})
	}
	switch value := seed.(type) {
	case string:
		if !utf8.ValidString(value) {
			return canonicalSeed{}, newDiceError("INVALID_SEED", "Text seeds must be valid UTF-8; use UTF16Seed for JS code units", "", nil)
		}
		length := int64(0)
		for _, char := range value {
			length++
			if char > 0xffff {
				length++
			}
		}
		if length > limit {
			return canonicalSeed{}, newDiceError("INVALID_SEED", "Text seed exceeds the maximum length", "", map[string]any{"seedLength": length, "maxSeedLength": limit})
		}
		return canonicalSeed{text: "string:" + value, length: int(length) + 7, origin: SeedProvidedString}, nil
	case UTF16Seed:
		if int64(len(value)) > limit {
			return canonicalSeed{}, newDiceError("INVALID_SEED", "Text seed exceeds the maximum length", "", map[string]any{"seedLength": len(value), "maxSeedLength": limit})
		}
		return canonicalSeed{text: "string:" + string(utf16.Decode(value)), length: len(value) + 7,
			origin: SeedProvidedString, explicitUnits: value}, nil
	default:
		number, ok := seedNumber(seed)
		if !ok {
			return canonicalSeed{}, newDiceError("INVALID_SEED", "Seeds must be finite numbers or strings", "", nil)
		}
		if math.IsNaN(number) || math.IsInf(number, 0) {
			value := "NaN"
			if math.IsInf(number, 1) {
				value = "Infinity"
			} else if math.IsInf(number, -1) {
				value = "-Infinity"
			}
			return canonicalSeed{}, newDiceError("INVALID_SEED", "Numeric seeds must be finite", "", map[string]any{"seed": value})
		}
		canonical := "number:" + seedNumberString(number)
		return canonicalSeed{text: canonical, length: len(canonical), origin: SeedProvidedNumber}, nil
	}
}

func seedNumber(value any) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case int:
		return seedNumber(int64(number))
	case int64:
		return float64(number), number >= -randomMaxSafeInteger && number <= randomMaxSafeInteger
	case int32:
		return float64(number), true
	case int16:
		return float64(number), true
	case int8:
		return float64(number), true
	case uint:
		return seedNumber(uint64(number))
	case uint64:
		return float64(number), number <= uint64(randomMaxSafeInteger)
	case uint32:
		return float64(number), true
	case uint16:
		return float64(number), true
	case uint8:
		return float64(number), true
	default:
		return 0, false
	}
}

// Go and ECMAScript both choose the shortest round-tripping decimal. Their
// formatting thresholds differ: JS uses fixed notation for [1e-6, 1e21).
func seedNumberString(value float64) string {
	if value == 0 {
		if math.Signbit(value) {
			return "-0"
		}
		return "0"
	}
	abs := math.Abs(value)
	if abs >= 1e-6 && abs < 1e21 {
		return strconv.FormatFloat(value, 'f', -1, 64)
	}
	formatted := strconv.FormatFloat(value, 'e', -1, 64)
	parts := strings.SplitN(formatted, "e", 2)
	exponent, _ := strconv.Atoi(parts[1])
	return parts[0] + "e" + fmt.Sprintf("%+d", exponent)
}

// Hash the canonical UTF-16 stream directly, without allocating rune or code-unit
// slices for ordinary UTF-8 strings. Explicit JS code units retain lone surrogates.
func hashCanonicalSeed(seed canonicalSeed) [4]uint32 {
	hash := uint32(1779033703) ^ uint32(seed.length)
	text := seed.text
	if seed.explicitUnits != nil {
		text = "string:"
	}
	for _, char := range text {
		if char > 0xffff {
			high, low := utf16.EncodeRune(char)
			hash = mixSeedUnit(hash, uint16(high))
			hash = mixSeedUnit(hash, uint16(low))
		} else {
			hash = mixSeedUnit(hash, uint16(char))
		}
	}
	for _, unit := range seed.explicitUnits {
		hash = mixSeedUnit(hash, unit)
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

func mixSeedUnit(hash uint32, unit uint16) uint32 {
	return rotateRandomLeft((hash^uint32(unit))*3432918353, 13)
}

func seedWordsHex(words [4]uint32) string {
	var bytes [16]byte
	for i, word := range words {
		binary.BigEndian.PutUint32(bytes[i*4:], word)
	}
	return hex.EncodeToString(bytes[:])
}

func CreateProvidedSeed(seed any, maxSeedLength ...int64) (SeedMaterial, error) {
	canonical, err := canonicalSeedData(seed, maxSeedLength)
	if err != nil {
		return SeedMaterial{}, err
	}
	words := hashCanonicalSeed(canonical)
	return SeedMaterial{CanonicalSeed: canonical.text, SeedMaterial: seedWordsHex(words), Origin: canonical.origin, Words: words}, nil
}

// CreateAutomaticSeed draws 128 bits from crypto/rand.Reader by default.
// Tests/adapters may inject a reader; explicit nil reports RNG_UNAVAILABLE.
// Injected bytes encode four big-endian words to make fixtures portable.
func CreateAutomaticSeed(source ...io.Reader) (SeedMaterial, error) {
	if len(source) > 1 {
		return SeedMaterial{}, newDiceError("RNG_UNAVAILABLE", "Only one cryptographic source may be provided", "", nil)
	}
	reader := io.Reader(rand.Reader)
	if len(source) == 1 {
		reader = source[0]
	}
	if reader == nil {
		return SeedMaterial{}, newDiceError("RNG_UNAVAILABLE", "A cryptographic random source is not available", "", nil)
	}
	var bytes [16]byte
	if _, err := io.ReadFull(reader, bytes[:]); err != nil {
		return SeedMaterial{}, newDiceError("RNG_UNAVAILABLE", "The cryptographic random source failed", "", nil)
	}
	var words [4]uint32
	for i := range words {
		words[i] = binary.BigEndian.Uint32(bytes[i*4:])
	}
	hex := seedWordsHex(words)
	return SeedMaterial{CanonicalSeed: "crypto:" + hex, SeedMaterial: hex, Origin: SeedCrypto, Words: words}, nil
}
