import { CoverSchema } from '#core/schemas';
import { url } from '#core/url';

import manifest from '../package.json' with { type: 'json' };
import { execution } from './execution.js';
import { failure, input, string } from './limits.js';

const { version } = manifest;
const escape = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function cover(value) {
  const result = CoverSchema.safeParse(value === undefined ? {} : value);

  if (!result.success) {
    throw failure('YAMB_CONTENT_INPUT', 'Invalid cover', result.error);
  }

  return result.data;
}

function postCover(value) {
  input(value && typeof value === 'object' && !Array.isArray(value), 'Expected a post record');
  string(value.title, 5000000, 'title');
  input(
    value.source &&
      typeof value.source === 'object' &&
      value.text &&
      typeof value.text === 'object',
    'Unexpected Markdown stage input'
  );
  input(
    value.cover && typeof value.cover === 'object' && !Array.isArray(value.cover),
    'Expected a cover record'
  );

  const { alt, caption, ...metadata } = value.cover;
  const result = cover(metadata);

  if (alt !== undefined) {
    result.alt = string(alt, 5000000, 'alt');
  }

  if (caption !== undefined) {
    result.caption = string(caption, 5000000, 'caption');
  }

  return result;
}

function content(value, field, format) {
  input(value && typeof value === 'object', `${field} must contain content`);
  const rendered = format === 'html';

  if (rendered) {
    input(
      !('tree' in value || 'plain' in value || 'feedHtml' in value),
      `${field} must contain HTML before cleanup`
    );
  }

  let introduction = null;

  if (value.introduction !== null) {
    introduction = { lines: value.introduction?.lines };

    if (rendered) {
      introduction.marker = value.introduction?.marker;
    }
  }

  if (rendered) {
    return { html: string(value.html, 5000000, `${field}.html`), introduction };
  }

  input(Array.isArray(value.tokens), `${field} must contain Markdown tokens`);

  return { tokens: value.tokens, introduction };
}

function fields(post, format) {
  const payload = { text: content(post.text, 'text', format) };

  if (post.preview !== undefined) {
    payload.preview = content(post.preview, 'preview', format);
  }

  return payload;
}

export function markdown() {
  const owner = execution();

  return {
    name: 'markdown',
    version,
    close: owner.close,
    [Symbol.asyncDispose]: owner.close,

    async transform(source, ctx = {}) {
      ctx.signal?.throwIfAborted();
      input(source && typeof source === 'object' && !Array.isArray(source), 'Expected PostData');
      string(source.title, 500, 'title');
      const payload = { text: string(source.text, 1048576, 'text') };

      if (source.preview !== undefined) {
        payload.preview = string(source.preview, 5000, 'preview');
      }

      if (source.tags !== undefined) {
        input(Array.isArray(source.tags), 'tags must be an array');

        for (const tag of source.tags) {
          string(tag, 64, 'tag');
        }
      }

      const image = cover(source.cover);
      const parsed = await owner.run('parse', payload, ctx);

      return { source, title: source.title, cover: image, ...parsed };
    },

    html() {
      return {
        name: 'markdown-html',
        version,

        async transform(value, ctx = {}) {
          ctx.signal?.throwIfAborted();
          const image = postCover(value);
          const title = string(escape(value.title), 5000000, 'title');

          if (image.caption !== undefined) {
            image.caption = string(escape(image.caption), 5000000, 'caption');
          }

          const rendered = await owner.run('html', fields(value, 'tokens'), ctx);

          return { source: value.source, title, cover: image, ...rendered };
        }
      };
    },

    clean() {
      return {
        name: 'clean-html',
        version,

        async transform(value, ctx = {}) {
          ctx.signal?.throwIfAborted();
          const image = postCover(value);
          input(
            value.source.uri === undefined || typeof value.source.uri === 'string',
            'source.uri must be a string'
          );

          let document;

          try {
            document = url(value.source.uri ?? '', ctx.base).href;
          } catch (cause) {
            throw failure('YAMB_CONTENT_INPUT', 'Invalid document URL context', cause);
          }

          const payload = { title: value.title, ...fields(value, 'html'), documentURL: document };

          if (image.caption !== undefined) {
            payload.caption = image.caption;
          }

          const { caption, ...prepared } = await owner.run('clean', payload, ctx);
          const { source } = value;

          if (image.url) {
            image.url = new URL(image.url, document).href;
          }

          if (image.caption !== undefined) {
            image.caption = caption;
          }

          return { source, ...prepared, cover: image };
        }
      };
    }
  };
}
