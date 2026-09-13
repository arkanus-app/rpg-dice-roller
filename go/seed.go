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
	canonical, _, _, err := canonicalSeedUnits(seed, maxSeedLength)
	return canonical, err
}

func canonicalSeedUnits(seed any, limits []int64) (string, []uint16, SeedOrigin, error) {
	limit := int64(1024)
	if len(limits) > 1 {
		return "", nil, "", newDiceError("INVALID_LIMIT", "Only one maxSeedLength may be provided", "", nil)
	}
	if len(limits) == 1 {
		limit = limits[0]
	}
	if limit < 1 || limit > randomMaxSafeInteger {
		return "", nil, "", newDiceError("INVALID_LIMIT", "maxSeedLength must be a positive safe integer", "", map[string]any{"maxSeedLength": limit})
	}
	var units []uint16
	var canonical string
	switch value := seed.(type) {
	case string:
		if !utf8.ValidString(value) {
			return "", nil, "", newDiceError("INVALID_SEED", "Text seeds must be valid UTF-8; use UTF16Seed for JS code units", "", nil)
		}
		length := int64(0)
		for _, char := range value {
			length++
			if char > 0xffff {
				length++
			}
		}
		if length > limit {
			return "", nil, "", newDiceError("INVALID_SEED", "Text seed exceeds the maximum length", "", map[string]any{"seedLength": length, "maxSeedLength": limit})
		}
		units = utf16.Encode([]rune(value))
		canonical = "string:" + value
	case UTF16Seed:
		if int64(len(value)) > limit {
			return "", nil, "", newDiceError("INVALID_SEED", "Text seed exceeds the maximum length", "", map[string]any{"seedLength": len(value), "maxSeedLength": limit})
		}
		units = value
		canonical = "string:" + string(utf16.Decode(value))
	default:
		number, ok := seedNumber(seed)
		if !ok {
			return "", nil, "", newDiceError("INVALID_SEED", "Seeds must be finite numbers or strings", "", nil)
		}
		if math.IsNaN(number) || math.IsInf(number, 0) {
			value := "NaN"
			if math.IsInf(number, 1) {
				value = "Infinity"
			} else if math.IsInf(number, -1) {
				value = "-Infinity"
			}
			return "", nil, "", newDiceError("INVALID_SEED", "Numeric seeds must be finite", "", map[string]any{"seed": value})
		}
		canonical = "number:" + seedNumberString(number)
		return canonical, utf16.Encode([]rune(canonical)), SeedProvidedNumber, nil
	}
	all := make([]uint16, 0, 7+len(units))
	all = append(all, 's', 't', 'r', 'i', 'n', 'g', ':')
	all = append(all, units...)
	return canonical, all, SeedProvidedString, nil
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

func hashSeedUnits(units []uint16) [4]uint32 {
	hash := uint32(1779033703) ^ uint32(len(units))
	for _, unit := range units {
		hash = (hash ^ uint32(unit)) * 3432918353
		hash = rotateRandomLeft(hash, 13)
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

func seedWordsHex(words [4]uint32) string {
	var bytes [16]byte
	for i, word := range words {
		binary.BigEndian.PutUint32(bytes[i*4:], word)
	}
	return hex.EncodeToString(bytes[:])
}

func CreateProvidedSeed(seed any, maxSeedLength ...int64) (SeedMaterial, error) {
	canonical, units, origin, err := canonicalSeedUnits(seed, maxSeedLength)
	if err != nil {
		return SeedMaterial{}, err
	}
	words := hashSeedUnits(units)
	return SeedMaterial{CanonicalSeed: canonical, SeedMaterial: seedWordsHex(words), Origin: origin, Words: words}, nil
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
