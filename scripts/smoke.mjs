import assert from 'node:assert/strict';

import { prepare } from '#core/transform';

import pkg from './package.json' with { type: 'json' };

const { markdown } = await import(pkg.name);

await using md = markdown();
const source = {
  title: 'Title',
  text: 'Intro\n\n---\n\n**Body**',
  cover: { url: './cover.jpg' }
};
const prepared = await prepare(source, [md, md.html(), md.clean()], {
  base: new URL('https://example.test/blog')
});

assert.match(prepared.text.html, /<strong>Body<\/strong>/);
assert.ok(Object.isFrozen(prepared.text.tree.children));
assert.equal(prepared.text.introduction.lines[0], 2);
assert.equal(prepared.cover.url, 'https://example.test/blog/cover.jpg');
