import { fromHtml } from 'hast-util-from-html';
import { defaultSchema, sanitize } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';
import { toText } from 'hast-util-to-text';

import { exceeded, input, introduction, MAX_DEPTH, MAX_HTML, MAX_NODES, string } from './limits.js';

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
  poster: ['http', 'https'],
  cite: ['http', 'https']
};
const urlProtocols = Object.fromEntries(
  Object.entries(protocols).map(([key, list]) => [key, list.map((protocol) => `${protocol}:`)])
);
const urlProperties = Object.keys(urlProtocols);

const blank = new Set(['\t', '\n', '\f', '\r', ' ']);
const descriptor = /^[\t\n\f\r ]*(?:(\d+w|(?:\d+(?:\.\d+)?|\.\d+)x)[\t\n\f\r ]*)?$/;

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
    img: ['src', 'srcSet', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding'],
    video: ['src', 'poster', 'controls', 'preload', 'width', 'height'],
    audio: ['src', 'controls', 'preload'],
    source: ['src', 'srcSet', 'sizes', 'type', 'media'],
    iframe: ['src', 'width', 'height', 'loading', 'allowFullScreen'],
    input: [['type', 'checkbox'], ['disabled', true], 'checked']
  },
  // The sanitizer compares schemes case-sensitively; tree() checks protocols after resolution.
  protocols: {}
};

function visit(node, fn, depth = 0) {
  const { children } = node;
  fn(node, depth);

  for (const child of children ?? []) {
    visit(child, fn, depth + 1);
  }
}

function iframe(src) {
  const parsed = typeof src === 'string' ? URL.parse(src) : null;

  return (
    parsed !== null &&
    urlProtocols.src.includes(parsed.protocol) &&
    hosts.has(parsed.hostname) &&
    !parsed.username &&
    !parsed.password
  );
}

function resolve(value, documentURL, allowed) {
  const resolved = URL.parse(String(value), documentURL);

  return resolved && allowed.includes(resolved.protocol) ? resolved : undefined;
}

function srcset(value, documentURL, field, budget) {
  const list = [];
  let index = 0;
  let length = 0;

  while (index < value.length) {
    if (blank.has(value[index]) || value[index] === ',') {
      index++;
      continue;
    }

    let end = index;

    while (end < value.length && !blank.has(value[end])) {
      end++;
    }

    let url = value.slice(index, end);
    let tail = '';

    if (url.endsWith(',')) {
      let last = url.length;

      while (url[last - 1] === ',') {
        last--;
      }

      url = url.slice(0, last);
    } else {
      const next = value.indexOf(',', end);
      tail = value.slice(end, next === -1 ? value.length : next);
      end = next === -1 ? value.length : next;
    }

    if (tail.includes('(')) {
      break;
    }

    index = end;

    const match = descriptor.exec(tail);
    const resolved =
      match &&
      (match[1] === undefined || Number.parseFloat(match[1]) > 0) &&
      resolve(url, documentURL, urlProtocols.src);

    if (!resolved || resolved.href.endsWith(',')) {
      continue;
    }

    const candidate = match[1] === undefined ? resolved.href : `${resolved.href} ${match[1]}`;
    length += candidate.length + 2;

    if (length > budget) {
      throw exceeded(field, 'srcset');
    }

    list.push(candidate);
  }

  return list.join(', ');
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

function policy({ tagNames = [], attributes = {} }) {
  const merged = { ...schema.attributes };

  for (const [tag, list] of Object.entries(attributes)) {
    merged[tag] = Object.hasOwn(merged, tag) ? [...merged[tag], ...list] : list;
  }

  return { ...schema, tagNames: [...schema.tagNames, ...tagNames], attributes: merged };
}

const defaultLabels = { audio: 'Open audio', video: 'Open video', spoiler: 'Spoiler' };

function tree(value, documentURL, field, marker, anchors, rules = schema, labels = defaultLabels) {
  string(value, MAX_HTML, field);

  const parsed = fromHtml(value, { fragment: true });
  let count = 0;
  let matches = 0;

  visit(parsed, (node, depth) => {
    if (++count > MAX_NODES || depth >= MAX_DEPTH) {
      throw exceeded(field);
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

  const cleaned = sanitize(parsed, rules);
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

    for (const key of Object.keys(node.properties)) {
      if (Array.isArray(node.properties[key]) && node.properties[key].length === 0) {
        delete node.properties[key];
      }
    }

    if (
      node.properties.srcSet !== undefined ||
      urlProperties.some((key) => node.properties[key] !== undefined)
    ) {
      links.push(node);
    }

    if (node.tagName === 'input') {
      node.properties.type = 'checkbox';
      node.properties.disabled = true;
    }

    if (node.tagName === 'span' && node.properties.className?.includes('spoiler')) {
      node.properties.title = labels.spoiler;
    } else if (node.tagName === 'span') {
      delete node.properties.tabIndex;
    }
  });

  const document = new URL(documentURL);
  document.hash = '';
  let budget = MAX_HTML;

  for (const node of links) {
    for (const key of urlProperties) {
      if (node.properties[key] === undefined) {
        continue;
      }

      const resolved = resolve(node.properties[key], documentURL, urlProtocols[key]);

      if (!resolved) {
        delete node.properties[key];
        continue;
      }

      if ((key === 'href' || key === 'cite') && resolved.hash) {
        rewriteFragment(resolved, document, anchors);
      }

      node.properties[key] = resolved.href;
    }

    if (node.properties.srcSet !== undefined) {
      const candidates = srcset(String(node.properties.srcSet), documentURL, field, budget);
      budget -= candidates.length;

      if (candidates) {
        node.properties.srcSet = candidates;
      } else {
        delete node.properties.srcSet;
      }
    }
  }

  return { tree: cleaned, index, hasMedia };
}

function feed(node, labels) {
  if (node.type === 'element' && media.has(node.tagName)) {
    const href =
      node.properties.src ??
      node.children.find((child) => child.tagName === 'source' && child.properties.src)?.properties
        .src;

    if (!href) {
      return { type: 'text', value: '' };
    }

    const label = node.properties.title || labels[node.tagName === 'audio' ? 'audio' : 'video'];

    return {
      type: 'element',
      tagName: 'a',
      properties: { href },
      children: [{ type: 'text', value: label }]
    };
  }

  let children;

  for (let index = 0; index < (node.children?.length ?? 0); index++) {
    const child = feed(node.children[index], labels);

    if (child !== node.children[index]) {
      children ??= [...node.children];
      children[index] = child;
    }
  }

  return children ? { ...node, children } : node;
}

export function clean(payload) {
  const anchors = new Map();
  const rules = policy(payload);
  const labels = { ...defaultLabels, ...payload.labels };

  function field(value, name) {
    input(value && typeof value === 'object', `${name} must contain HTML`);
    introduction(value.introduction, true);

    const {
      tree: cleaned,
      index,
      hasMedia
    } = tree(
      value.html,
      payload.documentURL,
      `${name}.html`,
      value.introduction?.marker,
      anchors,
      rules,
      labels
    );
    const lead = value.introduction ? toHtml(cleaned.children.slice(0, index)) : undefined;
    const body = value.introduction ? toHtml(cleaned.children.slice(index + 1)) : undefined;
    const html = string(
      value.introduction ? `${lead}${toHtml(cleaned.children[index])}${body}` : toHtml(cleaned),
      MAX_HTML,
      `${name}.html`
    );

    return {
      tree: cleaned,
      html,
      feedHtml: hasMedia
        ? string(toHtml(feed(cleaned, labels)), MAX_HTML, `${name}.feedHtml`)
        : html,
      plain: toText(cleaned),
      introduction: value.introduction
        ? { lines: [...value.introduction.lines], index, html: lead }
        : null,
      body: value.introduction ? { html: body } : null
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
