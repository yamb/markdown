import assert from 'node:assert/strict';
import { test } from 'node:test';

import { markdown } from '../src/index.js';

const ctx = { base: new URL('https://example.test/blog'), timeZone: 'UTC' };
const source = (extra) => ({ title: 'Title', text: 'Body', cover: {}, ...extra });

test('source ceilings count UTF-16 including astral characters', async () => {
  await using md = markdown();

  for (const [field, limit] of [
    ['title', 500],
    ['preview', 5000],
    ['text', 1048576],
    ['tag', 64]
  ]) {
    const exact = '😀'.repeat(limit / 2);
    const value = field === 'tag' ? { tags: [exact] } : { [field]: exact };
    await md.transform(source(value), ctx);

    const overflow = field === 'tag' ? { tags: [`${exact}a`] } : { [field]: `${exact}a` };
    await assert.rejects(md.transform(source(overflow), ctx), { code: 'YAMB_CONTENT_LIMIT' });
  }

  for (const cover of [
    null,
    'image.jpg',
    [],
    { caption: '😀'.repeat(2501) },
    { alt: '😀'.repeat(2501) }
  ]) {
    await assert.rejects(md.transform(source({ cover }), ctx), { code: 'YAMB_CONTENT_INPUT' });
  }
});

test('deep Markdown is rejected instead of silently truncating nesting', async () => {
  await using md = markdown();
  await assert.rejects(md.transform(source({ text: `${'> '.repeat(110)}deep` }), ctx), {
    code: 'YAMB_CONTENT_LIMIT'
  });

  assert.ok((await md.transform(source(), ctx)).text.tokens.length > 0);
});

test('token and HTML node ceilings reject large structures and keep owner reusable', async () => {
  await using md = markdown();
  await assert.rejects(md.transform(source({ text: 'a\n\n'.repeat(63000) }), ctx), {
    code: 'YAMB_CONTENT_LIMIT'
  });
  const parsed = await md.transform(source(), ctx);
  const html = await md.html().transform(parsed, ctx);

  await assert.rejects(
    md
      .clean()
      .transform({ ...html, text: { html: '<br>'.repeat(250000), introduction: null } }, ctx),
    { code: 'YAMB_CONTENT_LIMIT' }
  );

  await assert.rejects(
    md.clean().transform(
      {
        ...html,
        text: { html: `${'<div>'.repeat(100)}deep${'</div>'.repeat(100)}`, introduction: null }
      },
      ctx
    ),
    { code: 'YAMB_CONTENT_LIMIT' }
  );
  assert.match((await md.clean().transform(html, ctx)).text.html, /Body/);
});

test('every HTML field has a five million UTF-16 ceiling before cleanup', async () => {
  await using md = markdown();
  const parsed = await md.transform(source(), ctx);
  const html = await md.html().transform(parsed, ctx);
  const overflow = `${'😀'.repeat(2500000)}x`;

  for (const value of [
    { ...html, title: overflow },
    { ...html, cover: { caption: overflow } },
    { ...html, cover: { alt: overflow } },
    { ...html, text: { html: overflow, introduction: null } },
    { ...html, preview: { html: overflow, introduction: null } }
  ]) {
    await assert.rejects(md.clean().transform(value, ctx), { code: 'YAMB_CONTENT_LIMIT' });
  }

  const exact = '😀'.repeat(2500000);
  const result = await md
    .clean()
    .transform({ ...html, text: { html: exact, introduction: null } }, ctx);

  assert.equal(result.text.html.length, 5000000);
});

test('serialization and sanitized output expansion are bounded too', async () => {
  await using md = markdown();
  const parsed = await md.transform(source(), ctx);
  parsed.text.tokens.find((token) => token.type === 'inline').children[0].content = '&'.repeat(
    1000001
  );
  await assert.rejects(md.html().transform(parsed, ctx), { code: 'YAMB_CONTENT_LIMIT' });

  const html = {
    source: source(),
    title: 'title',
    cover: {},
    text: { html: '&'.repeat(1000001), introduction: null }
  };
  await assert.rejects(md.clean().transform(html, ctx), { code: 'YAMB_CONTENT_LIMIT' });

  assert.equal((await md.transform(source(), ctx)).title, 'Title');
});

test('plain cover alt preserves whitespace without typography and accepts bounded derived expansion', async () => {
  await using md = markdown();
  const original = source({ cover: { alt: 'т.е. '.repeat(1000) } });
  const tokens = await md.transform(original, ctx);
  const html = await md.html().transform(tokens, ctx);

  assert.equal((await md.clean().transform(html, ctx)).cover.alt, original.cover.alt);

  const expanded = 'т.\u00a0е. '.repeat(1000).trim();
  const result = await md.clean().transform({ ...html, cover: { alt: expanded } }, ctx);

  assert.equal(result.cover.alt, expanded);
  assert.equal(result.source.cover.alt, original.cover.alt);
});

test('malformed and non-transferable custom tokens fail without occupying the owner', async () => {
  await using md = markdown();
  for (const corrupt of [
    (value) => {
      value.text.tokens[0].meta = { fn() {} };
    },
    (value) => {
      value.text.tokens[0].attrs = 'invalid';
    },
    (value) => {
      value.text.tokens[0].children = [value.text.tokens[0]];
    },
    (value) => {
      value.text.tokens = 'invalid';
    }
  ]) {
    const value = await md.transform(source(), ctx);
    corrupt(value);

    await assert.rejects(md.html().transform(value, ctx), { code: 'YAMB_CONTENT_INPUT' });

    const good = await md.transform(source(), ctx);
    assert.match((await md.html().transform(good, ctx)).text.html, /Body/);
  }
});

test('stages reject mismatched input representations', async () => {
  await using md = markdown();
  await assert.rejects(md.html().transform(source(), ctx), { code: 'YAMB_CONTENT_INPUT' });

  const tokens = await md.transform(source(), ctx);
  await assert.rejects(md.clean().transform(tokens, ctx), { code: 'YAMB_CONTENT_INPUT' });

  const html = await md.html().transform(tokens, ctx);
  await assert.rejects(md.html().transform(html, ctx), { code: 'YAMB_CONTENT_INPUT' });
});

test('a custom transformer may repeat a block by sharing its existing tokens', async () => {
  await using md = markdown();
  const value = await md.transform(source({ text: 'Body **strong**' }), ctx);
  value.text.tokens = [...value.text.tokens, ...value.text.tokens];

  const html = await md.html().transform(value, ctx);
  assert.equal(html.text.html.match(/<strong>strong<\/strong>/g).length, 2);

  const result = await md.clean().transform(html, ctx);
  assert.equal(result.text.plain.match(/Body strong/g).length, 2);
});

test('shared token references still count every occurrence toward the budget', async () => {
  await using md = markdown();
  const value = await md.transform(source(), ctx);
  const token = value.text.tokens.find((item) => item.type === 'inline').children[0];
  value.text.tokens = Array(250001).fill(token);

  await assert.rejects(md.html().transform(value, ctx), { code: 'YAMB_CONTENT_LIMIT' });
});
