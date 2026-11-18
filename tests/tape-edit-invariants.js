import assert from "node:assert/strict";

import { applyTapeEdits } from "../app/src/main/assets/tape-engine.js";

function newlineCount(text) {
  return [...text].filter((character) => character === "\n").length;
}

function message(label, edit) {
  return JSON.stringify({ label, edit });
}

export function assertTapeEditInvariants(text, result, label = "") {
  for (const edit of result.edits) {
    const detail = message(label, edit);
    assert.ok(Number.isInteger(edit.start), detail);
    assert.ok(Number.isInteger(edit.end), detail);
    assert.ok(edit.start >= 0 && edit.start <= edit.end && edit.end <= text.length, detail);

    if (edit.kind === "insert-result") {
      assert.equal(edit.start, edit.end, detail);
      assert.equal(edit.start, edit.node.endOffset + 1, detail);
      assert.equal(newlineCount(edit.replacement), 1, detail);
      continue;
    }

    assert.equal(edit.kind, "replace-token", detail);
    assert.equal(edit.replacement.includes("\n"), false, detail);
    assert.equal(text.slice(edit.start, edit.end).includes("\n"), false, detail);

    const token = result.tokens.find((candidate) =>
      candidate.startLine === edit.line
      && candidate.endOffset + 1 === edit.end
      && (candidate.formatting ?? candidate.image) === edit.value
      && (candidate.formatting !== undefined || candidate.padding !== undefined));
    assert.ok(token, detail);

    const lineStart = token.startOffset - (token.startColumn - 1);
    const nextNewline = text.indexOf("\n", token.startOffset);
    const lineEnd = nextNewline < 0 ? text.length : nextNewline;
    assert.ok(edit.start >= lineStart, detail);
    assert.ok(edit.start <= token.startOffset, detail);
    assert.ok(edit.end <= lineEnd, detail);
    assert.match(text.slice(edit.start, token.startOffset), /^[ \t]*$/, detail);
  }

  const insertedNewlines = result.edits
    .filter((edit) => edit.kind === "insert-result")
    .reduce((total, edit) => total + newlineCount(edit.replacement), 0);
  const applied = applyTapeEdits(text, result.edits);
  assert.equal(
    newlineCount(applied),
    newlineCount(text) + insertedNewlines,
    JSON.stringify({ label, edits: result.edits }),
  );
}
