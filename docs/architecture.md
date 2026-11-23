# Markdown preparation architecture

The pipeline exposes editable token records before HTML conversion and sanitized projections after cleanup. Plugins can annotate tokens or transform HTML while storage and renderers retain access to the original source.

## Worker ownership

Each Markdown owner shares one worker across its three stages. The caller keeps the source record while [worker messages](../src/worker.js) carry only fields needed for parsing, serialization or cleanup. Plain token records cross the worker boundary; [serialization](../src/html.js) restores markdown-it token behavior inside the worker.

The [queue](../src/execution.js) bounds admitted work per owner. Cancellation of a queued request leaves the worker available. Cancellation or timeout of an active request terminates the worker, since synchronous parsing or sanitation cannot observe an abort message mid-call. The slot stays occupied until termination completes, and a subsequent request starts a fresh worker.

## Introduction provenance

[Parsing](../src/parse.js) selects the first eligible thematic-break token from the source. [Serialization](../src/html.js) attaches a per-result marker to that token’s HTML. [Cleanup](../src/clean.js) requires exactly one matching top-level break, drops the marker and returns its position in the final tree. Custom stages must carry the boundary metadata forward. Author HTML cannot establish a boundary by supplying an attribute.

See the [API reference](../api/readme.md) for stage shapes, limits and the cleanup policy.
