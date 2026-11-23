export function failure(code, message, cause) {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
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

export function structure(root, field, tokens = false) {
  let count = tokens ? -1 : 0;

  function visit(value, depth) {
    if (++count > 250000 || depth >= 100 || (tokens && value.level >= 100)) {
      throw Object.assign(failure('YAMB_CONTENT_LIMIT', `${field} structure exceeds budget`), {
        field
      });
    }

    if (value.children != null) {
      for (const child of value.children) {
        visit(child, depth + 1);
      }
    }
  }

  visit(root, tokens ? -1 : 0);
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
