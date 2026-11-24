import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toHtml } from 'hast-util-to-html';
import { prepare } from 'yamb/transform';

import { markdown } from '../src/index.js';

const ctx = { base: new URL('https://example.test/blog'), timeZone: 'UTC' };
const post = (text, extra = {}) => ({
  title: '<b>Title & word</b>',
  text,
  cover: {},
  uri: '2026/11/test',
  ...extra
});

async function prepareText(text, extra, stages = []) {
  await using md = markdown();

  return await prepare(post(text, extra), [md, ...stages, md.html(), md.clean()], ctx);
}

function elements(node, tag) {
  const matches = [];

  function visit(child) {
    if (child.tagName === tag) {
      matches.push(child);
    }

    for (const next of child.children ?? []) {
      visit(next);
    }
  }

  visit(node);
  return matches;
}

test('Markdown categories and nested inline extensions survive safe preparation', async () => {
  const result = await prepareText(
    '# Heading\n\n*em* **strong** ~~gone~~ ++under++ ==mark== ||hide *nested*||\n\n- [x] Done\n- [ ] Open\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst a = "<&>";\n```\n\n[link](./next) ![alt](./img.png)'
  );

  for (const tag of [
    'h1',
    'em',
    'strong',
    's',
    'u',
    'mark',
    'table',
    'input',
    'code',
    'a',
    'img'
  ]) {
    assert.ok(elements(result.text.tree, tag).length, tag);
  }

  assert.match(result.text.html, /class="spoiler"/);
  assert.match(result.text.html, /tabindex="0"/);
  assert.match(result.text.html, /title="Спойлер"/);
  assert.match(result.text.plain, /hide nested/);
  assert.equal(result.title, '<b>Title & word</b>');
  assert.ok(!Object.hasOwn(result, 'preview'));
  assert.ok(Object.isFrozen(result.text.tree.children));
});

test('escaped markers, code, links and nested pairs remain Markdown', async () => {
  const result = await prepareText(
    '\\|\\|literal\\|\\| `||code|| ++code++` ||a ||b|| c||\n\n++a ++b++ c++ ==a ==b== c==\n\n||[go](./next)||'
  );
  assert.match(result.text.plain, /\|\|literal\|\|/);
  assert.match(result.text.html, /<code>\|\|code\|\| \+\+code\+\+<\/code>/);
  assert.equal(elements(result.text.tree, 'span').length, 3);
  assert.equal(elements(result.text.tree, 'u').length, 2);
  assert.equal(elements(result.text.tree, 'mark').length, 2);
});

test('custom tokens and final HAST are available without parsing HTML', async () => {
  let links;
  const anchors = {
    name: 'anchors',
    transform(value) {
      assert.equal(Object.getPrototypeOf(value.text.tokens[0]), Object.prototype);

      for (const token of value.text.tokens) {
        if (token.type === 'heading_open') {
          (token.attrs ??= []).push(['id', 'part']);
        }

        if (token.children) {
          links = token.children.filter((t) => ['link_open', 'image'].includes(t.type));
        }
      }

      return value;
    }
  };

  const result = await prepareText(
    '## Heading\n\n[go](#part) ![image](./pic.png)',
    { preview: '[intro](#part)' },
    [anchors]
  );

  assert.equal(links.length, 2);

  const { id } = elements(result.text.tree, 'h2')[0].properties;
  assert.equal(id, 'user-content-part');
  assert.match(result.preview.html, /test#user-content-part/);
  assert.equal(
    elements(result.text.tree, 'img')[0].properties.src,
    'https://example.test/blog/2026/11/pic.png'
  );
});

for (const [input, boundary] of [
  ['Intro\n\n---\n\nBody\n\n---\n\nEnd', [2, 3]],
  ['---', [0, 1]],
  ['---\n\nBody', [0, 1]],
  ['Intro\n\n---', [2, 3]],
  ['Intro\r\n\r\n---\r\n\r\nBody', [2, 3]],
  ['Title\n---', null],
  ['> ---\n\nBody', null],
  ['- item\n\n  ---\n', null],
  ['```\n\n---\n\n```', null],
  ['    ---', null],
  [' ---', null],
  ['- - -', null],
  ['***', null],
  ['Intro\n---\nBody', null],
  ['No boundary', null]
]) {
  test(`introduction from source ${JSON.stringify(input)}`, async () => {
    const result = await prepareText(input);
    assert.equal(result.source.text, input);
    assert.deepEqual(result.text.introduction?.lines ?? null, boundary);

    if (boundary) {
      const { introduction, body } = result.text;
      assert.equal(result.text.tree.children[introduction.index].tagName, 'hr');
      assert.ok(!Object.hasOwn(introduction, 'marker'));
      assert.equal(result.text.html, `${introduction.html}<hr>${body.html}`);
    } else {
      assert.equal(result.text.body, null);
    }

    assert.equal(result.text.html, toHtml(result.text.tree));
    assert.doesNotMatch(result.text.html, /data-yamb-intro/);
  });
}

test('introduction and body arrive as ready HTML in text and preview', async () => {
  const result = await prepareText('Intro\n\n---\n\nBody\n\n---\n\nEnd', {
    preview: 'Lead\n\n---\n\nMore'
  });

  assert.equal(result.text.introduction.html, '<p>Intro</p>\n');
  assert.equal(result.text.body.html, '\n<p>Body</p>\n<hr>\n<p>End</p>\n');
  assert.equal(result.preview.introduction.html, '<p>Lead</p>\n');
  assert.equal(result.preview.body.html, '\n<p>More</p>\n');

  const edge = await prepareText('---');
  assert.equal(edge.text.introduction.html, '');
  assert.equal(edge.text.body.html, '\n');

  const none = await prepareText('Plain', { preview: 'Short' });
  assert.equal(none.preview.introduction, null);
  assert.equal(none.preview.body, null);
});

test('author marker spoof is removed and cannot steal the real boundary', async () => {
  const result = await prepareText('<hr data-yamb-intro="">\n\nIntro\n\n---\n\nBody');
  assert.deepEqual(result.text.introduction.lines, [4, 5]);
  assert.equal(elements(result.text.tree, 'hr').length, 2);
  assert.ok(result.text.introduction.index > 0);
  assert.match(result.text.introduction.html, /^<hr>\n<p>Intro<\/p>/);
  assert.equal(result.text.body.html, '\n<p>Body</p>\n');
  assert.doesNotMatch(result.text.html, /data-yamb-intro/);
});

test('lost or duplicated true introduction marker is an explicit error', async () => {
  await using md = markdown();
  const parsed = await md.transform(post('Intro\n\n---\n\nBody'), ctx);
  const html = await md.html().transform(parsed, ctx);
  const { marker } = html.text.introduction;

  for (const text of [
    html.text.html.replace(marker, 'lost'),
    `${html.text.html}<hr data-yamb-intro="${marker}">`
  ]) {
    await assert.rejects(
      md.clean().transform({ ...html, text: { ...html.text, html: text } }, ctx),
      { code: 'YAMB_CONTENT_INPUT' }
    );
  }

  assert.equal((await md.clean().transform(html, ctx)).text.introduction.lines[0], 2);
});

test('text, empty preview, source metadata and escaped title/caption remain independent', async () => {
  await using md = markdown();
  const source = post('Full', {
    preview: '',
    cover: {
      caption: '<b>Caption</b>',
      alt: '  <b>"raw"</b> &lt; &amp; &amp;quot;\r\n  two  words  ',
      url: './cover.jpg'
    },
    options: { title: '<script>' }
  });

  const tokens = await md.transform(source, ctx);
  const html = await md.html().transform(tokens, ctx);

  assert.equal(html.title, '&lt;b&gt;Title &amp; word&lt;/b&gt;');
  assert.equal(html.cover.caption, '&lt;b&gt;Caption&lt;/b&gt;');
  assert.equal(html.cover.alt, source.cover.alt);

  const result = await prepare(source, [md, md.html(), md.clean()], ctx);

  assert.equal(result.preview.html, '');
  assert.equal(result.cover.caption, '<b>Caption</b>');
  assert.equal(result.cover.alt, source.cover.alt);
  assert.equal(result.cover.url, 'https://example.test/blog/2026/11/cover.jpg');
  assert.equal(result.source.cover.url, './cover.jpg');
  assert.equal(result.source.options.title, '<script>');
});

test('cleanup rejects PreparedPost input', async () => {
  await using md = markdown();
  for (const title of ['<b>текст</b>', '&lt;b&gt;текст&lt;/b&gt;']) {
    const source = post('Full', { title, preview: 'Preview', cover: { caption: title } });
    const result = await prepare(source, [md, md.html(), md.clean()], ctx);

    assert.equal(result.title, title);
    assert.equal(result.cover.caption, title);
    assert.equal(result.text.introduction, null);

    await assert.rejects(md.clean().transform(result, ctx), { code: 'YAMB_CONTENT_INPUT' });
    await assert.rejects(
      prepare(source, [md, md.html(), md.clean(), md.clean()], ctx),
      (error) =>
        error.code === 'YAMB_TRANSFORM_FAILED' &&
        error.stage === 'clean-html' &&
        error.cause.code === 'YAMB_CONTENT_INPUT'
    );

    const html = await md.html().transform(await md.transform(source, ctx), ctx);
    await assert.rejects(md.clean().transform({ ...html, preview: result.preview }, ctx), {
      code: 'YAMB_CONTENT_INPUT'
    });

    for (const field of ['text', 'preview']) {
      for (const key of ['tree', 'plain', 'feedHtml']) {
        const value = { ...html, [field]: { ...html[field], [key]: result[field][key] } };
        await assert.rejects(md.clean().transform(value, ctx), { code: 'YAMB_CONTENT_INPUT' });
      }
    }

    html.text.metadata = { author: 'reader' };
    const next = await md.clean().transform(html, ctx);

    assert.equal(next.title, title);
    assert.equal(next.cover.caption, title);
    assert.equal(next.text.plain, 'Full');
  }
});

test('unsafe HTML and URLs are cleaned while media get safe feed projections', async () => {
  const result = await prepareText(
    '<script>alert(1)</script><style>body{}</style><p id="ok" onclick="evil()" style="color:red">Safe <a href="javascript:evil()">link</a><img src="data:x" onerror="evil()"></p>\n\n<figure><img src="./photo.jpg" alt="photo"><figcaption>Caption</figcaption></figure><video controls poster="./poster.jpg"><source src="./video.mp4"></video><audio src="./audio.mp3"></audio><iframe src="https://www.youtube.com/embed/1" title="Movie" srcdoc="evil"></iframe><iframe id="bad" src="https://evil.test/embed/1"></iframe>'
  );
  assert.doesNotMatch(
    result.text.html,
    /script|style|onclick|onerror|srcdoc|javascript:|data:x|evil.test/
  );
  assert.equal(elements(result.text.tree, 'iframe').length, 1);
  assert.match(result.text.html, /<figure>/);
  assert.doesNotMatch(result.text.feedHtml, /<(?:iframe|audio|video)/);
  assert.match(result.text.feedHtml, /href="https:\/\/example.test\/blog\/2026\/11\/video.mp4"/);
  assert.match(result.text.feedHtml, /Movie/);
  assert.match(result.text.feedHtml, />Open video<\/a>/);
  assert.match(result.text.feedHtml, />Open audio<\/a>/);
  assert.match(result.text.plain, /Safe link/);
});

test('feed labels replace the default media link text', async () => {
  await using md = markdown();
  const source = post(
    '<video src="./video.mp4"></video><audio src="./audio.mp3"></audio><iframe src="https://www.youtube.com/embed/1" title="Movie"></iframe>'
  );
  const feedLabels = { video: 'Watch video', audio: 'Listen to audio' };
  const result = await prepare(source, [md, md.html(), md.clean({ feedLabels })], ctx);

  assert.match(result.text.feedHtml, />Watch video<\/a>/);
  assert.match(result.text.feedHtml, />Listen to audio<\/a>/);
  assert.match(result.text.feedHtml, />Movie<\/a>/);

  const partial = await prepare(
    source,
    [md, md.html(), md.clean({ feedLabels: { audio: 'Listen' } })],
    ctx
  );
  assert.match(partial.text.feedHtml, />Open video<\/a>/);
  assert.match(partial.text.feedHtml, />Listen<\/a>/);
});

test('picture candidates resolve like src and unsafe candidates are dropped', async () => {
  const result = await prepareText(
    '<picture><source type="image/avif" srcset="./a.avif 1x, /b.avif 2x" sizes="(max-width: 600px) 100vw, 600px"><img src="./a.jpg" srcset="./a.jpg 640w,./b.jpg 1280w" sizes="100vw" alt="Photo"></picture><video src="./v.mp4"></video>\n\n<img srcset="javascript:evil() 1x, data:x 2x, ./ok.jpg 3x, ./bad.jpg 2q, ./zero.jpg 0w, ./none.jpg 0.0x, ./ctl,&#1; 1x, ./c,d.jpg 4x, ./e.jpg, ./f.jpg 1.5x"><img srcset="javascript:evil() 1x, ,"><img srcset="https://example.test/x.jpg 1x 2x"><img srcset="./p.jpg 1x, ./q.jpg (1, ./r.jpg 2x)">'
  );
  const [source] = elements(result.text.tree, 'source');
  const [img, mixed, unsafe, malformed, nested] = elements(result.text.tree, 'img');

  assert.equal(
    source.properties.srcSet,
    'https://example.test/blog/2026/11/a.avif 1x, https://example.test/b.avif 2x'
  );
  assert.equal(source.properties.sizes, '(max-width: 600px) 100vw, 600px');
  assert.equal(
    img.properties.srcSet,
    'https://example.test/blog/2026/11/a.jpg 640w, https://example.test/blog/2026/11/b.jpg 1280w'
  );
  assert.equal(img.properties.sizes, '100vw');
  assert.equal(
    mixed.properties.srcSet,
    'https://example.test/blog/2026/11/ok.jpg 3x, https://example.test/blog/2026/11/c,d.jpg 4x, https://example.test/blog/2026/11/e.jpg, https://example.test/blog/2026/11/f.jpg 1.5x'
  );
  assert.ok(!Object.hasOwn(unsafe.properties, 'srcSet'));
  assert.ok(!Object.hasOwn(malformed.properties, 'srcSet'));
  assert.equal(nested.properties.srcSet, 'https://example.test/blog/2026/11/p.jpg 1x');
  assert.doesNotMatch(result.text.html, /javascript:|data:x/);
  assert.notEqual(result.text.feedHtml, result.text.html);
  assert.ok(
    result.text.feedHtml.includes(
      'srcset="https://example.test/blog/2026/11/a.avif 1x, https://example.test/b.avif 2x"'
    )
  );
});

test('configured attributes survive only on their tags and with their values', async () => {
  await using md = markdown();
  const source = post(
    '<a href="./x" target="_blank" rel="nofollow noopener" data-gallery="false" data-other="1" data-2x="2" aria-label="Open" aria-foo="f" aria-hidden="true" onclick="evil()">x</a> <a href="./y" target="_self" aria-hidden="false">y</a> <a href="./z" rel="noopener">z</a>\n\n<p class="" data-gallery="true">p</p>'
  );
  const allowed = {
    a: [
      ['target', '_blank'],
      ['rel', 'nofollow'],
      'data-gallery',
      'data-2x',
      'aria-label',
      'aria-foo',
      ['aria-hidden', 'true']
    ]
  };

  const strict = await prepare(source, [md, md.html(), md.clean()], ctx);
  assert.doesNotMatch(strict.text.html, /target|rel=|data-|aria-label|onclick/);

  const result = await prepare(source, [md, md.html(), md.clean({ attributes: allowed })], ctx);
  const [first, second, third] = elements(result.text.tree, 'a');

  assert.deepEqual(first.properties, {
    href: 'https://example.test/blog/2026/11/x',
    target: '_blank',
    rel: ['nofollow'],
    dataGallery: 'false',
    data2x: '2',
    ariaLabel: 'Open',
    'aria-foo': 'f',
    ariaHidden: 'true'
  });
  assert.deepEqual(second.properties, { href: 'https://example.test/blog/2026/11/y' });
  assert.deepEqual(third.properties, { href: 'https://example.test/blog/2026/11/z' });
  assert.deepEqual(elements(result.text.tree, 'p').at(-1).properties, {});
  assert.doesNotMatch(result.text.html, /rel=""|class=""/);
  assert.doesNotMatch(strict.text.html, /class=""/);

  const prototypeKey = md.clean({ attributes: { constructor: ['data-x'] } });
  const html = await md.html().transform(await md.transform(source, ctx), ctx);
  assert.equal((await prototypeKey.transform(html, ctx)).text.html, strict.text.html);
});

test('configured legacy tags and attributes survive, URL attributes resolve', async () => {
  await using md = markdown();
  const source = post(
    '<header><h2 id="head">Head</h2></header>\n\n<p><img src="./a.jpg" align="left" itemprop="image"> <img src="./b.jpg" align="middle"> <cite>Book</cite></p>\n\n<blockquote cite="./source">a</blockquote><blockquote cite="javascript:alert(1)">b</blockquote><blockquote cite="#head">d</blockquote><q cite="https://other.test/q">c</q>\n\n<iframe src="https://www.youtube.com/embed/x" frameborder="0" marginheight="0" marginwidth="0" scrolling="no"></iframe>'
  );
  const options = {
    tagNames: ['header', 'cite'],
    attributes: {
      img: [['align', 'left', 'right'], 'itemprop'],
      blockquote: ['cite'],
      iframe: ['frameborder', 'marginheight', 'marginwidth', 'scrolling']
    }
  };

  const strict = await prepare(source, [md, md.html(), md.clean()], ctx);
  assert.doesNotMatch(
    strict.text.html,
    /<header|<cite|align=|itemprop|cite=|frameborder|marginheight|marginwidth|scrolling/
  );
  assert.match(strict.text.html, /Book/);

  const result = await prepare(source, [md, md.html(), md.clean(options)], ctx);
  const { tree } = result.text;
  const [header] = elements(tree, 'header');
  const [first, second] = elements(tree, 'img');
  const [cited, unsafe, local] = elements(tree, 'blockquote');

  assert.equal(header.children.find((node) => node.tagName === 'h2').children[0].value, 'Head');
  assert.equal(elements(tree, 'cite')[0].children[0].value, 'Book');
  assert.equal(first.properties.align, 'left');
  assert.deepEqual(first.properties.itemProp, ['image']);
  assert.ok(!Object.hasOwn(second.properties, 'align'));
  assert.equal(cited.properties.cite, 'https://example.test/blog/2026/11/source');
  assert.ok(!Object.hasOwn(unsafe.properties, 'cite'));
  assert.match(local.properties.cite, /#user-content-head$/);
  assert.ok(!Object.hasOwn(elements(tree, 'q')[0].properties, 'cite'));
  assert.match(
    result.text.html,
    /<iframe src="https:\/\/www\.youtube\.com\/embed\/x" frameborder="0" marginheight="0" marginwidth="0" scrolling="no">/
  );
  assert.doesNotMatch(result.text.html, /javascript:/);
});

test('cleanup options reject unknown keys and unsafe or reserved attributes', async () => {
  await using md = markdown();
  for (const options of [
    undefined,
    {},
    { attributes: undefined },
    { attributes: {} },
    { tagNames: undefined },
    { tagNames: [] },
    { feedLabels: undefined },
    { feedLabels: {} },
    Object.assign(Object.create(null), { attributes: Object.create(null) })
  ]) {
    assert.equal(md.clean(options).name, 'clean-html');
  }

  for (const options of [
    null,
    [],
    { other: true },
    { attributes: [] },
    { attributes: { a: 'rel' } },
    { attributes: { A: ['rel'] } },
    { attributes: { '*': ['rel'] } },
    { attributes: { a: ['style'] } },
    { attributes: { a: ['onclick'] } },
    { attributes: { a: ['href'] } },
    { attributes: { img: ['srcset'] } },
    { attributes: { a: ['Data-x'] } },
    { attributes: { a: ['dataGallery'] } },
    { attributes: { hr: ['data-yamb-intro'] } },
    { attributes: { a: ['data-yamb'] } },
    { attributes: { a: [['rel']] } },
    { attributes: { a: [['rel', 1]] } },
    { attributes: { a: [['rel', 'nofollow noopener']] } },
    { attributes: { a: ['rel', ['rel', 'nofollow']] } },
    { attributes: { a: Object.assign([], { 1: 'rel' }) } },
    { attributes: { h2: [['aria-level', '2']] } },
    { attributes: { a: [Object.create(null)] } },
    { attributes: { a: [[Object.create(null), 'x']] } },
    { attributes: { iframe: ['srcdoc'] } },
    { attributes: { img: ['onerror'] } },
    { attributes: { blockquote: [['cite', 'https://example.test/']] } },
    { attributes: { iframe: [['marginheight', '0']] } },
    { tagNames: 'header' },
    { tagNames: ['Header'] },
    { tagNames: ['header', 'header'] },
    { tagNames: ['script'] },
    { tagNames: ['style'] },
    { tagNames: ['form'] },
    { tagNames: ['svg'] },
    { tagNames: ['p'] },
    { tagNames: [1] },
    { feedLabels: null },
    { feedLabels: ['Watch'] },
    { feedLabels: { image: 'View' } },
    { feedLabels: { video: 1 } },
    { feedLabels: { video: ' ' } },
    { feedLabels: { audio: '\uD800' } }
  ]) {
    assert.throws(() => md.clean(options), { code: 'YAMB_CONTENT_INPUT' }, JSON.stringify(options));
  }
});

test('relative and protocol-relative iframe are rejected before URL resolution', async () => {
  await using md = markdown();
  const result = await prepare(
    post(
      '<iframe src="/embed/x"></iframe><iframe src="./embed/x"></iframe><iframe src="//www.youtube.com/embed/x"></iframe>'
    ),
    [md, md.html(), md.clean()],
    { ...ctx, base: new URL('https://www.youtube.com') }
  );
  assert.equal(elements(result.text.tree, 'iframe').length, 0);
});

test('literal Unicode and percent ids resolve once, only within the same document and query', async () => {
  for (const id of ['part', 'раздел', 'é%41', 'раздел%20', 'a%20b']) {
    const fragment = encodeURIComponent(id);
    const result = await prepareText(
      `<h2 id="${id}">Heading</h2><a href="#${fragment}">local</a><a href="https://example.test/blog/2026/11/test#${fragment}">absolute</a><a href="?q=1#${fragment}">query</a><a href="https://other.test/#${fragment}">external</a>`,
      { preview: `[preview](#${fragment})` }
    );
    const finalId = elements(result.text.tree, 'h2')[0].properties.id;
    const links = elements(result.text.tree, 'a');

    assert.equal(decodeURIComponent(new URL(links[0].properties.href).hash.slice(1)), finalId);
    assert.equal(links[0].properties.href, links[1].properties.href);
    assert.equal(
      decodeURIComponent(
        new URL(elements(result.preview.tree, 'a')[0].properties.href).hash.slice(1)
      ),
      finalId
    );
    assert.equal(new URL(links[2].properties.href).hash.slice(1), fragment);
    assert.equal(new URL(links[3].properties.href).hash.slice(1), fragment);
  }
});
