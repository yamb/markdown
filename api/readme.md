# Markdown preparation API

Use the [quick start](../readme.md#quick-start) to run the parse → HTML → cleanup pipeline. The [Yamb core reference](https://github.com/yamb/yamb#reference) covers `prepare`, `transform` and application-owned caching.

## Stages and ownership

`markdown()` takes no configuration and returns the `markdown` transformer plus `html()`, `clean(options?)`, `close()` and `Symbol.asyncDispose`. Each stage exposes `{ name, version, transform(value, ctx) }`; `html()` and `clean()` share their owner's worker. Context supplies `base: URL` for cleanup and optional `signal: AbortSignal` for all stages.

| Stage | Input → result | `text` and optional `preview` |
| --- | --- | --- |
| `md` (`markdown`) | PostData → TokenPost | `{ tokens, introduction: null \| { lines } }` |
| `md.html()` (`markdown-html`) | TokenPost → HtmlPost | `{ html, introduction: null \| { lines, marker } }` |
| `md.clean()` (`clean-html`) | HtmlPost → PreparedPost | `{ tree, html, feedHtml, plain, introduction: null \| { lines, index, html }, body: null \| { html } }` |

All three forms carry `{ source, title, cover, text, preview? }`. Title and cover caption are plain in TokenPost and PreparedPost, and escaped in HtmlPost. Markdown leaves cover alt intact. Derived cover is independent of source cover; cleanup resolves its URL. Source fields, including cover and preview, remain unchanged. An empty preview stays present and empty. The full text retains its introduction.

Tokens are plain markdown-it records. `attrs` is an array of `[name, value]` string pairs or `null`. `children` is an array or `null`, and `map` is a zero-based `[start, end)` line range or `null`. Shared references count once per occurrence. Cycles fail.

Place token transforms between `md` and `md.html()`. This stage assigns heading IDs.

```js
const anchors = {
  name: 'article-anchors',
  version: '1',

  transform(value) {
    let index = 0;

    for (const token of value.text.tokens) {
      if (token.type === 'heading_open') {
        (token.attrs ??= []).push(['id', `section-${++index}`]);
      }
    }

    return value;
  }
};
```

Place HTML transforms between `md.html()` and `md.clean()`. Optional [MicroTypo](https://github.com/yamb/microtypo#reference) occupies that position and owns its native typography settings. Preserve introduction metadata and its marked token/HTML through custom stages. Cleanup must follow every HTML-producing stage; passing tokens to cleanup or cleaning PreparedPost again fails with `YAMB_CONTENT_INPUT`.

Each stage owns its intermediate result: edit tokens in place, keep `source` unchanged and release mutable references when handing the result onward. Final `tree` is a HAST root with `children`; elements have `tagName`, `properties` and `children`, and text nodes have `value`. Standard HAST position fields may remain. Inspect this tree for final headings, links and images. `prepare` returns deeply frozen JSON data; edit a `structuredClone` when a mutable copy is needed. Store source Markdown as PostData; PreparedPost is a derived projection, with no tokens, engine or worker handles.

## Markdown format

The parser uses markdown-it's default preset with HTML enabled, linkification and typography disabled, and ordinary soft line breaks. It adds these extensions:

| Syntax                     | Result                                                |
| -------------------------- | ----------------------------------------------------- |
| Pipe tables, `~~deleted~~` | Tables and strikethrough from the default preset      |
| `- [x] Done`, `- [ ] Open` | Disabled task checkboxes                              |
| `++underlined++`           | `<u>`                                                 |
| `==highlighted==`          | `<mark>`                                              |
| `\|\|spoiler\|\|`          | `<span class="spoiler" tabindex="0" title="Spoiler">` |

Headings, lists, quotes, links, images, indented/fenced code and raw HTML use markdown-it rules. The paired inline extensions support nesting, including identical nested pairs, and a single intervening newline; escaped markers and code remain literal. `|||x|||` leaves one literal pipe on each side of a spoiler. Headings receive IDs only when supplied by HTML or a custom transform. Spoiler styling belongs to the application. Parser plugins and settings are fixed.

### Introduction and preview

The first top-level thematic break whose entire source line is exactly `---`, with blank lines or file boundaries on both sides, marks the introduction. Setext headings, code, lists and quotes do not create it; `- - -`, `***` and indented ` ---` remain ordinary Markdown. A boundary at the start/end permits an empty introduction/body. It never creates a preview or removes text.

`introduction` is `null` without a boundary. Otherwise `lines: [start, end]` is its zero-based source range with an exclusive end. Original CRLF/CR remain in `source`; parsing normalizes line endings. The selected token carries `meta.yambIntroduction: true`. HtmlPost uses an unpredictable `marker` and matching `data-yamb-intro` attribute to preserve provenance across HTML transforms. A missing/duplicated marker or a boundary moved out of the top level fails with `YAMB_CONTENT_INPUT`; author-supplied attributes cannot select a boundary. Cleanup removes temporary markers and returns the actual zero-based `index` of the boundary `<hr>` in `tree.children`, including whitespace nodes in the count.

`introduction.html` serializes the nodes before the boundary and `body.html` the nodes after it, without the `<hr>`; the page `html` joins them around it. Both are page HTML, not feed projections. `body` is `null` exactly when `introduction` is. The same parts are `tree.children.slice(0, index)` and `tree.children.slice(index + 1)` in HAST. Preview is parsed and cleaned independently with the same boundary rules.

## Cleanup and URLs

Cleanup parses HTML fragments with `hast-util-from-html` and uses `hast-util-sanitize`'s default schema with the policy in [src/clean.js](../src/clean.js). It removes executable elements, event/style/srcdoc attributes and elements and data attributes that the [cleanup options](#additional-elements-and-attributes) do not allow. Classes, IDs, language/direction and selected presentation/media attributes survive; empty space-separated attributes such as `class=""` are removed. Checkboxes are forced disabled; only spoiler spans retain `tabindex="0"`. Cleanup makes no network requests.

| Content | Policy |
| --- | --- |
| Links | HTTP, HTTPS, mailto and tel |
| Images, video/audio/source, posters, `srcset` candidates | HTTP and HTTPS resources; figures/captions and `sizes` retained |
| Iframes | Absolute HTTP(S), no credentials; exact hostname `www.youtube.com`, `www.youtube-nocookie.com`, `player.vimeo.com` or `www.slideshare.net` |
| Feed HTML | Images/captions retained; video/audio/iframe replaced by a link to `src` or the first source URL, using the element title or a [label](#labels); missing safe sources produce no link |

Relative and protocol-relative iframe sources fail the policy before URL resolution, even on an allowed document origin. Other resource URLs resolve normally. Each `srcset` candidate on `img` and `source` resolves like `src`; a candidate with another protocol, several descriptors or a descriptor other than a positive integer `w` or decimal `x` is dropped, a parenthesis in descriptors ends the attribute, and an attribute with no candidates left is removed. The schema restricts markup and protocols; it does not fetch, proxy or authenticate destination content. Put cleanup last and escape plain fields for the renderer's output format.

The document URL is `url(source.uri ?? '', ctx.base).href` from `yamb/url`, which treats the blog base as a directory. Resources and derived `cover.url` then use native `new URL(value, documentURL)`:

| Base / URI                                      | Document / resource                           |
| ----------------------------------------------- | --------------------------------------------- |
| `https://example.test/blog` / `2026/11/example` | `https://example.test/blog/2026/11/example`   |
| `./cover.jpg` relative to that document         | `https://example.test/blog/2026/11/cover.jpg` |
| `/image.jpg` relative to that document          | `https://example.test/image.jpg`              |

### Additional elements and attributes

`md.clean({ tagNames, attributes })` extends the policy. `tagNames` keeps extra elements that cleanup otherwise unwraps; only `abbr`, `address`, `article`, `aside`, `cite`, `footer`, `header` and `small` are accepted. A kept element is no longer unwrapped, so an introduction boundary inside it is not at the top level and the transform fails.

`attributes` keeps extra attributes on allowed elements, including those added by `tagNames`. Keys are lowercase tag names. Each entry is an HTML attribute name, or a `[name, ...values]` tuple that also restricts the value, compared case-sensitively, which cannot narrow an attribute the policy already allows on that tag; space-separated attributes such as `rel` keep only the listed tokens and drop the attribute when none remain. Accepted names are `target`, `rel`, `data-*` and `aria-*`, in lowercase ASCII letters and digits with hyphen-separated segments, and the legacy `align`, `cite`, `frameborder`, `itemprop`, `marginheight`, `marginwidth` and `scrolling`. `cite` is resolved against the document and its fragment rewritten like `href`, and dropped unless it is `http` or `https`. Other names, `data-yamb` and `data-yamb-*`, repeated names, tuples for numeric attributes or `cite`, unknown option keys and malformed entries throw `YAMB_CONTENT_INPUT` when the stage is created.

Restrict `target` and `rel` with tuples: a bare `rel` keeps author values such as `opener`. Cleanup prefixes `aria-describedby` and `aria-labelledby` like IDs but does not inspect other data or ARIA values: references such as `aria-controls` can name host page IDs, and scripts that read URLs from data attributes apply their own policy. The options change the output; include them in the application's cache key.

```js
const clean = md.clean({
  tagNames: ['header', 'cite'],
  attributes: {
    a: [['target', '_blank'], ['rel', 'nofollow'], 'data-gallery'],
    img: [['align', 'left', 'right']],
    blockquote: ['cite']
  }
});
```

### Labels

`md.clean({ labels: { spoiler, video, audio } })` sets interface text. `spoiler` is the title of every spoiler span, `Spoiler` by default. `video` and `audio` are the text of the feed link that replaces a media element without a title, `Open video` and `Open audio` by default; `video` also covers iframes. Each label is a well-formed, non-blank string of at most 200 UTF-16 units; other keys and values throw `YAMB_CONTENT_INPUT` when the stage is created. Labels change the output; include them in the application's cache key.

### Fragments

Sanitized IDs receive `user-content-`. Local href fragments are rewritten only when they match a surviving literal ID and resolve to the same document path and query. Fragment decoding and final ID encoding happen once, preserving Unicode and literal percent signs. Unknown/malformed fragments and links to a different document/query keep their resolved fragment. Preview can target full-text IDs; full text is cleaned first. Build navigation from final HAST IDs.

## Limits and lifecycle

Limits are fixed; overflow rejects rather than truncates. String lengths count UTF-16 code units.

| Resource | Maximum |
| --- | --- |
| Source `title` / `preview` / each tag / `text` | 500 / 5000 / 64 / 1048576 units |
| Source cover | Core cover schema |
| Each derived HTML string, including escaped title/caption and feed HTML, and plain cover alt | 5000000 units |
| Each field's token occurrences / parsed HAST nodes (including HAST root) | 250000; depth below 100, token level below 100 |
| Per owner | One active job and eight waiting jobs |
| Wall deadline per stage request | 15000 ms from enqueue, including queue time |
| Worker V8 budgets | Old generation 512 MiB, young generation 32 MiB, stack 8 MiB |

Reuse one owner across posts. The worker starts on demand, and an idle worker does not keep the process alive. After rendering finishes, call `await md.close()` or use `await using`. Closure is idempotent, rejects outstanding work and waits for shutdown. All stages reject after close. V8 budgets apply to JS heap. Application transforms must cooperate with cancellation.

| Error code | Cause |
| --- | --- |
| `YAMB_CONTENT_INPUT` | Invalid input/stage, malformed tokens, lost introduction, transfer failure or closed owner |
| `YAMB_CONTENT_LIMIT` | String/structure budget exceeded; includes `field` |
| `YAMB_CONTENT_BUSY` | Queue full |
| `YAMB_CONTENT_TIMEOUT` | Wall deadline exceeded |
| `YAMB_CONTENT_WORKER` | Worker start, crash, exit (including an exhausted V8 budget) or message failure |

Errors retain causes where present. The core executor wraps stage failures with stage/cause; native `AbortSignal.reason` values propagate unchanged, including non-Error reasons. No partial PreparedPost is returned on failure.
