export interface NormalizedDiceInput {
  readonly input: string;
  readonly comment: string;
  readonly notation: string;
  readonly normalizedNotation: string;
  readonly rollCount: number;
  readonly isMultiRoll: boolean;
}

interface CleanedInput {
  readonly notation: string;
  readonly comment: string;
}

function isDigit(value: string): boolean {
  return value >= '0' && value <= '9';
}

function isAlpha(value: string): boolean {
  return /^[a-z]$/i.test(value);
}

function isIdentifierBoundary(value: string): boolean {
  return value === '' || !/[a-z0-9_]/i.test(value);
}

function readWhile(
  source: string,
  start: number,
  matcher: (value: string) => boolean,
): readonly [string, number] {
  let cursor = start;

  while (cursor < source.length && matcher(source.charAt(cursor))) {
    cursor += 1;
  }

  return [source.slice(start, cursor), cursor];
}

function cleanInput(input: string): CleanedInput {
  const comments: string[] = [];
  let notation = '';
  let cursor = 0;
  let retainedMultiRollMarker = false;

  const pushComment = (comment: string): void => {
    const normalized = comment.trim();
    if (normalized.length > 0) {
      comments.push(normalized);
    }
  };

  while (cursor < input.length) {
    const current = input.charAt(cursor);
    const next = input.charAt(cursor + 1);

    if (current === '/' && next === '*') {
      const end = input.indexOf('*/', cursor + 2);
      const commentEnd = end < 0 ? input.length : end;
      pushComment(input.slice(cursor + 2, commentEnd));
      cursor = end < 0 ? input.length : end + 2;
      continue;
    }

    if (current === '/' && next === '/') {
      const lineEndMatch = /[\n\r\u2028\u2029]/u.exec(input.slice(cursor + 2));
      const lineEnd = lineEndMatch?.index === undefined
        ? input.length
        : cursor + 2 + lineEndMatch.index;
      pushComment(input.slice(cursor + 2, lineEnd));
      cursor = lineEnd;
      continue;
    }

    if (current === '[') {
      const end = input.indexOf(']', cursor + 1);
      const commentEnd = end < 0 ? input.length : end;
      pushComment(input.slice(cursor + 1, commentEnd));
      cursor = end < 0 ? input.length : end + 1;
      continue;
    }

    if (current === '#') {
      const compactPrefix = notation.replace(/\s+/gu, '');
      const isMultiRollMarker = !retainedMultiRollMarker && /^\d+$/u.test(compactPrefix);

      if (isMultiRollMarker) {
        notation += current;
        retainedMultiRollMarker = true;
        cursor += 1;
        continue;
      }

      const lineEndMatch = /[\n\r\u2028\u2029]/u.exec(input.slice(cursor + 1));
      const lineEnd = lineEndMatch?.index === undefined
        ? input.length
        : cursor + 1 + lineEndMatch.index;
      pushComment(input.slice(cursor + 1, lineEnd));
      cursor = lineEnd;
      continue;
    }

    if (!/\s/u.test(current)) {
      notation += current;
    }
    cursor += 1;
  }

  return {
    notation,
    comment: comments.join(' ').trim(),
  };
}

function readDiceSides(source: string, start: number): readonly [string, number] {
  const current = source.charAt(start);

  if (current === '(') {
    return ['', start];
  }

  if (current === '%') {
    return ['%', start + 1];
  }

  if (current.toUpperCase() === 'F') {
    let cursor = start + 1;
    if (source.charAt(cursor) === '.' && ['1', '2'].includes(source.charAt(cursor + 1))) {
      cursor += 2;
      return [`F.${source.charAt(cursor - 1)}`, cursor];
    }
    return ['F', cursor];
  }

  if (isDigit(current)) {
    return readWhile(source, start, isDigit);
  }

  return ['20', start];
}

function normalizeAlphaToken(token: string, next: string): string {
  const lowerToken = token.toLowerCase();

  if (
    lowerToken === 'f'
    && isIdentifierBoundary(next)
    && !['<', '>', '=', '!'].includes(next)
  ) {
    return '4dF';
  }

  if (lowerToken === 'ei' && (isDigit(next) || ['<', '>', '=', '!', ''].includes(next))) {
    return isDigit(next) ? '!>=' : '!';
  }

  if (lowerToken === 'km') {
    return isDigit(next) ? 'kl' : 'kl1';
  }

  if (lowerToken === 'kh' || lowerToken === 'kl') {
    return isDigit(next) ? lowerToken : `${lowerToken}1`;
  }

  if (lowerToken === 'k') {
    return isDigit(next) ? 'k' : 'k1';
  }

  return token;
}

function normalizeFriendlyTokens(notation: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < notation.length) {
    const char = notation.charAt(cursor);

    if (isDigit(char)) {
      const [quantity, afterQuantity] = readWhile(notation, cursor, isDigit);
      const marker = notation.charAt(afterQuantity);

      if (marker.toLowerCase() === 'd') {
        const [sides, afterSides] = readDiceSides(notation, afterQuantity + 1);
        output += Number(quantity) === 0 ? '0' : `${quantity}d${sides}`;
        cursor = afterSides;
        continue;
      }

      if (
        marker.toLowerCase() === 'f'
        && isIdentifierBoundary(notation.charAt(afterQuantity + 1))
        && !['<', '>', '=', '!'].includes(notation.charAt(afterQuantity + 1))
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
      const next = notation.charAt(cursor + 1);

      if (next.toLowerCase() === 'f') {
        const [sides, afterSides] = readDiceSides(notation, cursor + 1);
        output += `d${sides}`;
        cursor = afterSides;
        continue;
      }

      if (
        next === ''
        || isIdentifierBoundary(next)
        || isDigit(next)
        || next === '%'
      ) {
        const [sides, afterSides] = readDiceSides(notation, cursor + 1);
        output += `d${sides}`;
        cursor = afterSides;
        continue;
      }
    }

    if (isAlpha(char)) {
      const [token, afterToken] = readWhile(notation, cursor, isAlpha);
      output += normalizeAlphaToken(token, notation.charAt(afterToken));
      cursor = afterToken;
      continue;
    }

    output += char;
    cursor += 1;
  }

  return output;
}

function normalizeSimpleOperators(notation: string): string {
  let normalized = notation;
  let previous = '';

  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized
      .replace(/\+-/gu, '-')
      .replace(/-\+/gu, '-')
      .replace(/\+\+/gu, '+')
      .replace(/--/gu, '+');
  }

  return normalized.replace(/[+-]{3,}/gu, '+').replace(/^[+-]/u, '');
}

export function normalizeRpgDiceNotation(input: string): string {
  const cleaned = cleanInput(input);
  return normalizeSimpleOperators(normalizeFriendlyTokens(cleaned.notation));
}

export function parseNormalizedDiceInput(input: string): NormalizedDiceInput {
  const cleaned = cleanInput(input);
  const normalizedNotation = normalizeSimpleOperators(normalizeFriendlyTokens(cleaned.notation));
  const multiRollMatch = /^(\d+)#/u.exec(normalizedNotation);
  const rollCountText = multiRollMatch?.[1];
  const rollCount = rollCountText === undefined ? 1 : Number.parseInt(rollCountText, 10);
  const notation = multiRollMatch === null
    ? normalizedNotation
    : normalizedNotation.slice(multiRollMatch[0].length);

  return {
    input,
    comment: cleaned.comment,
    notation,
    normalizedNotation,
    rollCount,
    isMultiRoll: multiRollMatch !== null,
  };
}
