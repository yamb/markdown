import { inlineRule } from '@mdit/plugin-inline-rule';
import MarkdownIt from 'markdown-it';
import ins from 'markdown-it-ins';
import mark from 'markdown-it-mark';
import tasks from 'markdown-it-task-lists';

import { inline } from './inline.js';
import { structure } from './limits.js';

const blank = (line) => /^[\t ]*$/.test(line);

export function parser() {
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false, maxNesting: 101 })
    .use(ins)
    .use(mark)
    .use(inlineRule, {
      marker: '|',
      tag: 'span',
      token: 'spoiler',
      nested: true,
      double: true,
      placement: 'before-emphasis',
      attrs: [
        ['class', 'spoiler'],
        ['tabindex', '0'],
        ['title', 'Spoiler']
      ]
    })
    .use(tasks)
    .use(inline);

  md.renderer.rules.ins_open = () => '<u>';
  md.renderer.rules.ins_close = () => '</u>';

  md.core.ruler.after('block', 'introduction', (state) => {
    const lines = state.src.split('\n');

    const token = state.tokens.find((node) => {
      if (node.type !== 'hr' || node.level !== 0 || node.markup !== '---' || !node.map) {
        return false;
      }

      const line = node.map[0];

      return (
        lines[line] === '---' &&
        (line === 0 || blank(lines[line - 1])) &&
        (line === lines.length - 1 || blank(lines[line + 1]))
      );
    });

    if (token) {
      token.meta = { ...token.meta, yambIntroduction: true };
    }
  });

  return md;
}

export function parse(md, source, field) {
  const tokens = md.parse(source, {});
  structure(tokens, field);

  const token = tokens.find((node) => node.meta?.yambIntroduction === true);

  return { tokens, introduction: token ? { lines: [...token.map] } : null };
}
