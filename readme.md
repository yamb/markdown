# @meritt/yamb-markdown

[![npm version][npm-image]][npm-url] [![Build status][github-actions-image]][github-actions-url] [![Coverage status][coveralls-image]][coveralls-url] [![Dependency status][libraries-image]][libraries-url]

Parse source Markdown into editable tokens, render HTML, then derive sanitized page HTML, feed HTML and plain text for [Yamb](https://github.com/yamb/yamb).

For GitHub Packages, route the `@yamb` scope to `https://npm.pkg.github.com` and install `@yamb/markdown`.

## Quick start

Requires Node.js 26.13 or later and `yamb`.

```bash
pnpm add yamb @meritt/yamb-markdown
```

```js
import { markdown } from '@meritt/yamb-markdown';
import { prepare } from 'yamb/transform';

await using md = markdown();

const stages = [md, md.html(), md.clean()];

const source = {
  uri: '2026/11/guide',
  title: 'Guide',
  text: 'An **example** with [a link](./next).'
};

const prepared = await prepare(source, stages, {
  base: new URL('https://example.com/blog'),
  timeZone: 'UTC'
});

console.log(prepared.text.html);
console.log(prepared.text.plain);
```

For a live Post, pass `post.toJSON()`.

## Reference

- [Stage representations and extension example](api/readme.md#stages-and-ownership)
- [Markdown dialect](api/readme.md#markdown-format), [cleanup and URLs](api/readme.md#cleanup-and-urls), [limits](api/readme.md#limits-and-lifecycle)
- [Yamb core reference](https://github.com/yamb/yamb#reference) for preparation and caching
- [Architecture](docs/architecture.md)

## Author

[Alexey Simonenko](https://simonenko.xyz)

## License

MIT. See `LICENSE`.

[npm-image]: https://img.shields.io/npm/v/@meritt/yamb-markdown?style=flat
[npm-url]: https://www.npmjs.com/package/@meritt/yamb-markdown
[github-actions-image]: https://github.com/yamb/markdown/actions/workflows/ci.yml/badge.svg
[github-actions-url]: https://github.com/yamb/markdown/actions/workflows/ci.yml
[coveralls-image]: https://coveralls.io/repos/github/yamb/markdown/badge.svg
[coveralls-url]: https://coveralls.io/github/yamb/markdown
[libraries-image]: https://img.shields.io/librariesio/release/npm/%40meritt%2Fyamb-markdown?style=flat
[libraries-url]: https://libraries.io/npm/%40meritt%2Fyamb-markdown
