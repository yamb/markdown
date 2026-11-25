import { parentPort } from 'node:worker_threads';

import { clean } from './clean.js';
import { html } from './html.js';
import { failure, input } from './limits.js';
import { parse, parser } from './parse.js';

const md = parser();

function fields(op, payload) {
  input(op === 'parse' || op === 'html', 'Unknown Markdown operation');

  const field = op === 'parse' ? parse : html;
  const result = { text: field(md, payload.text, 'text') };

  if (payload.preview !== undefined) {
    result.preview = field(md, payload.preview, 'preview');
  }

  return result;
}

parentPort.on('message', ({ op, payload }) => {
  try {
    const value = op === 'clean' ? clean(payload) : fields(op, payload);
    parentPort.postMessage({ ok: true, value });
  } catch (cause) {
    const error = cause.code
      ? cause
      : failure('YAMB_CONTENT_INPUT', 'Invalid Markdown content', cause);

    const reply = { name: error.name, code: error.code, message: error.message };

    if (error.field !== undefined) {
      reply.field = error.field;
    }

    if (error.cause !== undefined) {
      const { name, message, code } = error.cause;
      reply.cause = { name, message, code };
    }

    parentPort.postMessage({ ok: false, error: reply });
  }
});
