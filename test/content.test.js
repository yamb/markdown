import assert from 'node:assert/strict';
import { test } from 'node:test';

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
      assert.equal(result.text.tree.children[result.text.introduction.index].tagName, 'hr');
      assert.ok(!Object.hasOwn(result.text.introduction, 'marker'));
    }

    assert.doesNotMatch(result.text.html, /data-yamb-intro/);
  });
}

test('author marker spoof is removed and cannot steal the real boundary', async () => {
  const result = await prepareText('<hr data-yamb-intro="">\n\nIntro\n\n---\n\nBody');
  assert.deepEqual(result.text.introduction.lines, [4, 5]);
  assert.equal(elements(result.text.tree, 'hr').length, 2);
  assert.ok(result.text.introduction.index > 0);
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
  assert.match(result.text.plain, /Safe link/);
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
