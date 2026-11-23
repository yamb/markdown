import { fromHtml } from 'hast-util-from-html';
import { defaultSchema, sanitize } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';
import { toText } from 'hast-util-to-text';

import { failure, input, introduction, string } from './limits.js';

const media = new Set(['iframe', 'video', 'audio']);
const hosts = new Set([
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'www.slideshare.net'
]);
const protocols = {
  href: ['http', 'https', 'mailto', 'tel'],
  src: ['http', 'https'],
  poster: ['http', 'https']
};
const urlProperties = Object.keys(protocols);
const urlProtocols = {};

for (const key of urlProperties) {
  urlProtocols[key] = protocols[key].map((protocol) => `${protocol}:`);
}

const schema = {
  ...defaultSchema,
  tagNames: [
    ...defaultSchema.tagNames,
    's',
    'u',
    'mark',
    'span',
    'figure',
    'figcaption',
    'video',
    'audio',
    'source',
    'iframe'
  ],
  attributes: {
    '*': ['id', 'title', 'lang', 'dir', 'className'],
    a: ['href'],
    code: ['className'],
    ol: ['start'],
    li: ['value'],
    td: ['align', 'colSpan', 'rowSpan'],
    th: ['align', 'colSpan', 'rowSpan'],
    hr: ['dataYambIntro'],
    span: [['tabIndex', 0]],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    video: ['src', 'poster', 'controls', 'preload', 'width', 'height'],
    audio: ['src', 'controls', 'preload'],
    source: ['src', 'type', 'media'],
    iframe: ['src', 'width', 'height', 'loading', 'allowFullScreen'],
    input: [['type', 'checkbox'], ['disabled', true], 'checked']
  },
  protocols
};

function visit(node, fn, depth = 0) {
  const { children } = node;
  fn(node, depth);

  for (const child of children ?? []) {
    visit(child, fn, depth + 1);
  }
}

function iframe(src) {
  if (typeof src !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(src);

    return (
      urlProtocols.src.includes(parsed.protocol) &&
      hosts.has(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function rewriteFragment(resolved, document, anchors) {
  const target = new URL(resolved);
  target.hash = '';

  if (target.href !== document.href) {
    return;
  }

  let fragment;

  try {
    fragment = decodeURIComponent(resolved.hash.slice(1));
  } catch {
    return;
  }

  if (anchors.has(fragment)) {
    resolved.hash = encodeURIComponent(anchors.get(fragment));
  }
}

function tree(value, documentURL, field, marker, anchors) {
  string(value, 5000000, field);

  const parsed = fromHtml(value, { fragment: true });
  let count = 0;
  let matches = 0;

  visit(parsed, (node, depth) => {
    if (++count > 250000 || depth >= 100) {
      throw Object.assign(failure('YAMB_CONTENT_LIMIT', `${field} structure exceeds budget`), {
        field
      });
    }

    if (node.tagName === 'iframe' && !iframe(node.properties.src)) {
      node.tagName = 'span';
      node.properties = {};
      node.children = [];
    }

    const { properties } = node;

    if (!properties || !Object.hasOwn(properties, 'dataYambIntro')) {
      return;
    }

    if (marker && properties.dataYambIntro === marker && node.tagName === 'hr') {
      matches++;
      properties.dataYambIntro = '';
    } else {
      delete properties.dataYambIntro;
    }
  });
  input(!marker || matches === 1, `${field} introduction marker lost or duplicated`);

  const cleaned = sanitize(parsed, schema);
  const index = marker
    ? cleaned.children.findIndex(
        (node) => node.tagName === 'hr' && Object.hasOwn(node.properties, 'dataYambIntro')
      )
    : -1;
  input(!marker || index >= 0, `${field} introduction must survive at the top level`);

  const links = [];
  let hasMedia = false;

  visit(cleaned, (node) => {
    const id = node.properties?.id;

    if (typeof id === 'string' && id.startsWith(schema.clobberPrefix)) {
      anchors.set(id.slice(schema.clobberPrefix.length), id);
    }

    if (node.type !== 'element') {
      return;
    }

    delete node.properties.dataYambIntro;
    hasMedia ||= media.has(node.tagName);

    if (
      node.properties.href !== undefined ||
      node.properties.src !== undefined ||
      node.properties.poster !== undefined
    ) {
      links.push(node);
    }

    if (node.tagName === 'input') {
      node.properties.type = 'checkbox';
      node.properties.disabled = true;
    }

    if (node.tagName === 'span' && !node.properties.className?.includes('spoiler')) {
      delete node.properties.tabIndex;
    }
  });

  const document = new URL(documentURL);
  document.hash = '';

  for (const node of links) {
    for (const key of urlProperties) {
      if (node.properties[key] === undefined) {
        continue;
      }

      let resolved;

      try {
        resolved = new URL(String(node.properties[key]), documentURL);
      } catch {
        delete node.properties[key];
        continue;
      }

      if (!urlProtocols[key].includes(resolved.protocol)) {
        delete node.properties[key];
        continue;
      }

      if (key === 'href' && resolved.hash) {
        rewriteFragment(resolved, document, anchors);
      }

      node.properties[key] = resolved.href;
    }
  }

  return { tree: cleaned, index, hasMedia };
}

function feed(node) {
  if (node.type === 'element' && media.has(node.tagName)) {
    const href =
      node.properties.src ??
      node.children.find((child) => child.tagName === 'source' && child.properties.src)?.properties
        .src;

    if (!href) {
      return { type: 'text', value: '' };
    }

    const label =
      node.properties.title || (node.tagName === 'audio' ? 'Открыть аудио' : 'Открыть видео');

    return {
      type: 'element',
      tagName: 'a',
      properties: { href },
      children: [{ type: 'text', value: label }]
    };
  }

  let children;

  for (let index = 0; index < (node.children?.length ?? 0); index++) {
    const child = feed(node.children[index]);

    if (child !== node.children[index]) {
      children ??= [...node.children];
      children[index] = child;
    }
  }

  return children ? { ...node, children } : node;
}

export function clean(payload) {
  const anchors = new Map();

  function field(value, name) {
    input(value && typeof value === 'object', `${name} must contain HTML`);
    introduction(value.introduction, true);

    const {
      tree: cleaned,
      index,
      hasMedia
    } = tree(value.html, payload.documentURL, `${name}.html`, value.introduction?.marker, anchors);
    const html = string(toHtml(cleaned), 5000000, `${name}.html`);

    return {
      tree: cleaned,
      html,
      feedHtml: hasMedia ? string(toHtml(feed(cleaned)), 5000000, `${name}.feedHtml`) : html,
      plain: toText(cleaned),
      introduction: value.introduction ? { lines: [...value.introduction.lines], index } : null
    };
  }

  const text = field(payload.text, 'text');
  const preview = payload.preview === undefined ? undefined : field(payload.preview, 'preview');
  const plain = (value, name) =>
    toText(tree(value, payload.documentURL, name, undefined, new Map()).tree);

  const result = { title: plain(payload.title, 'title'), text };

  if (preview !== undefined) {
    result.preview = preview;
  }

  if (payload.caption !== undefined) {
    result.caption = plain(payload.caption, 'caption');
  }

  return result;
}
