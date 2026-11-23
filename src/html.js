import { randomUUID } from 'node:crypto';

import MarkdownIt from 'markdown-it';

import { failure, input, introduction, string } from './limits.js';

export function html(md, value, field) {
  input(value && Array.isArray(value.tokens), `${field} must contain Markdown tokens`);

  if (value.tokens.length > 250000) {
    throw Object.assign(failure('YAMB_CONTENT_LIMIT', `${field} structure exceeds budget`), {
      field
    });
  }

  introduction(value.introduction);

  const marker = value.introduction ? randomUUID() : undefined;
  const path = new WeakSet();
  let count = 0;
  let marked = 0;

  function restore(token, depth = 0) {
    input(
      token && typeof token === 'object' && !path.has(token),
      `${field} has invalid or cyclic tokens`
    );

    if (++count > 250000 || depth >= 100 || token.level >= 100) {
      throw Object.assign(failure('YAMB_CONTENT_LIMIT', `${field} structure exceeds budget`), {
        field
      });
    }

    input(
      typeof token.type === 'string' &&
        typeof token.tag === 'string' &&
        [-1, 0, 1].includes(token.nesting) &&
        Number.isSafeInteger(token.level) &&
        token.level >= 0 &&
        typeof token.content === 'string' &&
        typeof token.info === 'string',
      `${field} has malformed tokens`
    );
    input(
      token.attrs === null ||
        (Array.isArray(token.attrs) &&
          token.attrs.every(
            (pair) =>
              Array.isArray(pair) &&
              pair.length === 2 &&
              pair.every((item) => typeof item === 'string')
          )),
      `${field} has malformed attributes`
    );
    input(
      token.children == null || Array.isArray(token.children),
      `${field}.children must be an array`
    );

    if ((token.children?.length ?? 0) > 250000 - count) {
      throw Object.assign(failure('YAMB_CONTENT_LIMIT', `${field} structure exceeds budget`), {
        field
      });
    }

    path.add(token);
    const node = Object.assign(new MarkdownIt.Token(token.type, token.tag, token.nesting), token);
    node.children = token.children?.map((child) => restore(child, depth + 1)) ?? null;
    node.attrs = token.attrs?.filter(([name]) => name.toLowerCase() !== 'data-yamb-intro') ?? null;

    if (token.meta?.yambIntroduction === true) {
      marked++;
      input(
        marker &&
          depth === 0 &&
          token.type === 'hr' &&
          token.level === 0 &&
          Array.isArray(token.map) &&
          token.map.length === 2 &&
          token.map.every((line, index) => line === value.introduction.lines[index]),
        `${field} introduction must be a top-level hr`
      );
      node.attrSet('data-yamb-intro', marker);
    }

    path.delete(token);

    return node;
  }

  const tokens = value.tokens.map((token) => restore(token));
  input(
    value.introduction ? marked === 1 : marked === 0,
    `${field} introduction token lost or duplicated`
  );

  const result = md.renderer.render(tokens, md.options, {});
  string(result, 5000000, `${field}.html`);

  return {
    html: result,
    introduction: marker ? { lines: [...value.introduction.lines], marker } : null
  };
}
