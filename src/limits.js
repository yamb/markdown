export const MAX_HTML = 5000000;
export const MAX_NODES = 250000;
export const MAX_DEPTH = 100;

export function failure(code, message, cause) {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

export function exceeded(field, what = 'structure') {
  return Object.assign(failure('YAMB_CONTENT_LIMIT', `${field} ${what} exceeds budget`), { field });
}

export function input(condition, message) {
  if (!condition) {
    throw failure('YAMB_CONTENT_INPUT', message);
  }
}

export function string(value, limit, field) {
  input(typeof value === 'string', `${field} must be a string`);

  if (value.length > limit) {
    throw Object.assign(failure('YAMB_CONTENT_LIMIT', `${field} exceeds ${limit} UTF-16 units`), {
      field
    });
  }

  return value;
}

export function structure(tokens, field) {
  let count = 0;

  function visit(token, depth) {
    if (++count > MAX_NODES || depth >= MAX_DEPTH || token.level >= MAX_DEPTH) {
      throw exceeded(field);
    }

    for (const child of token.children ?? []) {
      visit(child, depth + 1);
    }
  }

  for (const token of tokens) {
    visit(token, 0);
  }
}

export function introduction(value, needsMarker = false) {
  if (value === null) {
    return;
  }

  const lines = value && value.lines;
  input(
    Array.isArray(lines) &&
      lines.length === 2 &&
      lines.every(Number.isSafeInteger) &&
      lines[0] >= 0 &&
      lines[1] > lines[0],
    'invalid introduction'
  );

  if (needsMarker) {
    input(typeof value.marker === 'string' && value.marker.length > 0, 'invalid introduction');
  }
}
