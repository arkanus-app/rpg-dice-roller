const blockCommentPattern = /\/\*([\s\S]*?)\*\//g;
const lineCommentPattern = /\/\/([^\n\r]*)/g;
const whitespacePattern = /\s+/g;

interface NormalizationRule {
  name: string;
  apply: (notation: string) => string;
}

function isDigit(value: string): boolean {
  return /^\d$/.test(value);
}

function isAlpha(value: string): boolean {
  return /^[a-z]$/i.test(value);
}

function isIdentifierBoundary(value: string | undefined): boolean {
  return !value || !/[a-z0-9_]/i.test(value);
}

function readWhile(
  source: string,
  start: number,
  matcher: (value: string) => boolean,
): [string, number] {
  let cursor = start;

  while (cursor < source.length && matcher(source[cursor])) {
    cursor += 1;
  }

  return [source.slice(start, cursor), cursor];
}

function readDiceSides(source: string, start: number): [string, number] {
  const current = source[start];

  if (current === '%') {
    return ['%', start + 1];
  }

  if (current && current.toUpperCase() === 'F') {
    return ['F', start + 1];
  }

  if (current && isDigit(current)) {
    return readWhile(source, start, isDigit);
  }

  return ['20', start];
}

function normalizeAlphaToken(token: string, next: string | undefined): string {
  const lowerToken = token.toLowerCase();

  if (
    lowerToken === 'f'
    && isIdentifierBoundary(next)
    && !['<', '>', '=', '!'].includes(next ?? '')
  ) {
    return '4dF';
  }

  if (
    (lowerToken === 'ei')
    && (isDigit(next ?? '') || ['<', '>', '=', '!', undefined].includes(next))
  ) {
    return isDigit(next ?? '') ? '!>=' : '!';
  }

  if (lowerToken === 'km') {
    return isDigit(next ?? '') ? 'kl' : 'kl1';
  }

  if ((lowerToken === 'kh') || (lowerToken === 'kl')) {
    return isDigit(next ?? '') ? lowerToken : `${lowerToken}1`;
  }

  if (lowerToken === 'k') {
    return isDigit(next ?? '') ? 'k' : 'k1';
  }

  return token;
}

/* eslint-disable no-continue */
function normalizeFriendlyTokens(notation: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < notation.length) {
    const char = notation[cursor];

    if (isDigit(char)) {
      const [quantity, afterQuantity] = readWhile(notation, cursor, isDigit);
      const marker = notation[afterQuantity];

      if (marker && marker.toLowerCase() === 'd') {
        const [sides, afterSides] = readDiceSides(notation, afterQuantity + 1);
        output += (Number(quantity) === 0) ? '0' : `${quantity}d${sides}`;
        cursor = afterSides;
        continue;
      }

      if (
        marker
        && marker.toLowerCase() === 'f'
        && isIdentifierBoundary(notation[afterQuantity + 1])
        && !['<', '>', '=', '!'].includes(notation[afterQuantity + 1] ?? '')
      ) {
        output += `${quantity}dF`;
        cursor = afterQuantity + 1;
        continue;
      }

      output += quantity;
      cursor = afterQuantity;
      continue;
    }

    if (char.toLowerCase() === 'd') {
      const next = notation[cursor + 1];

      if (next && next.toLowerCase() === 'f') {
        output += 'dF';
        cursor += 2;
        continue;
      }

      if (
        !next
        || isIdentifierBoundary(next)
        || isDigit(next)
        || next === '%'
        || next.toLowerCase() === 'f'
      ) {
        const [sides, afterSides] = readDiceSides(notation, cursor + 1);
        output += `d${sides}`;
        cursor = afterSides;
        continue;
      }
    }

    if (isAlpha(char)) {
      const [token, afterToken] = readWhile(notation, cursor, isAlpha);
      output += normalizeAlphaToken(token, notation[afterToken]);
      cursor = afterToken;
      continue;
    }

    output += char;
    cursor += 1;
  }

  return output;
}
/* eslint-enable no-continue */

function normalizeSimpleOperators(notation: string): string {
  let normalized = notation;
  let previous: string;

  do {
    previous = normalized;
    normalized = normalized
      .replace(/\+-/g, '-')
      .replace(/-\+/g, '-')
      .replace(/\+\+/g, '+')
      .replace(/--/g, '+');
  } while (normalized !== previous);

  return normalized.replace(/[+-]{3,}/g, '+').replace(/^[+-]/, '');
}

const notationNormalizationRules: NormalizationRule[] = [
  {
    name: 'friendly-token-scanner',
    apply: normalizeFriendlyTokens,
  },
  {
    name: 'simple-operators',
    apply: normalizeSimpleOperators,
  },
];

const NORMALIZATION_CACHE_LIMIT = 200;
const normalizationCache = new Map<string, string>();

function cacheSet(key: string, value: string): string {
  if (normalizationCache.has(key)) {
    normalizationCache.delete(key);
  }

  normalizationCache.set(key, value);

  if (normalizationCache.size > NORMALIZATION_CACHE_LIMIT) {
    const [oldestKey] = normalizationCache.keys();
    if (typeof oldestKey === 'string') {
      normalizationCache.delete(oldestKey);
    }
  }

  return value;
}

export function extractRpgDiceComment(input: string): string {
  const source = String(input ?? '');
  const comments: string[] = [];

  source.replace(blockCommentPattern, (_match, comment: string) => {
    comments.push(comment.trim());
    return _match;
  });

  source.replace(lineCommentPattern, (_match, comment: string) => {
    comments.push(comment.trim());
    return _match;
  });

  return comments
    .filter(Boolean)
    .join(' ')
    .replace(/\{[^}]+\}/g, '')
    .trim();
}

export function cleanRpgDiceNotation(input: string): string {
  return String(input ?? '')
    .replace(blockCommentPattern, '')
    .replace(lineCommentPattern, '')
    .replace(whitespacePattern, '');
}

export function normalizeRpgDiceNotation(input: string): string {
  const source = String(input ?? '');
  const cached = normalizationCache.get(source);

  if (typeof cached === 'string') {
    normalizationCache.delete(source);
    normalizationCache.set(source, cached);
    return cached;
  }

  return cacheSet(
    source,
    notationNormalizationRules
      .reduce((notation, rule) => rule.apply(notation), cleanRpgDiceNotation(source)),
  );
}
