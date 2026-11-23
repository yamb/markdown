// The upstream text rule consumes `|` before the spoiler rule can see it.
const terminators = new Set([
  10, 33, 35, 36, 37, 38, 42, 43, 45, 58, 60, 61, 62, 64, 91, 92, 93, 94, 95, 96, 123, 124, 125, 126
]);

export function inline(md) {
  md.inline.ruler.at('text', (state, silent) => {
    let end = state.pos;

    while (end < state.posMax && !terminators.has(state.src.charCodeAt(end))) {
      end++;
    }

    if (end === state.pos) {
      return false;
    }

    if (!silent) {
      state.pending += state.src.slice(state.pos, end);
    }

    state.pos = end;

    return true;
  });
}
