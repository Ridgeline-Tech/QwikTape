import {
  applyTapeEdits,
  calculateTape,
  resultBlockAt,
} from "./tape-engine.js";

function selectionAfterEdits(position, edits) {
  return [...edits]
    .sort((left, right) => left.start - right.start)
    .reduce((next, edit) => {
      if (edit.end <= next) return next + edit.replacement.length - (edit.end - edit.start);
      if (edit.start < next) return edit.start + edit.replacement.length;
      return next;
    }, position);
}

export function applyEnter({ text, selectionStart, selectionEnd, settings = {} }) {
  const block = selectionStart === selectionEnd
    ? resultBlockAt(text, selectionStart)
    : null;
  if (block) {
    const afterBlock = text[block.end] === "\n" ? block.end + 1 : block.end;
    const addition = afterBlock === block.end ? "\n" : "";
    const nextText = `${text.slice(0, afterBlock)}${addition}${text.slice(afterBlock)}`;
    const caret = afterBlock + addition.length;
    return { handled: true, text: nextText, selectionStart: caret, selectionEnd: caret };
  }

  const source = `${text.slice(0, selectionStart)}\n${text.slice(selectionEnd)}`;
  const caret = selectionStart + 1;
  const result = calculateTape({ text: source, ...settings });
  const formattingEdits = result.edits.filter((edit) => edit.kind === "replace-token");
  const selectedInsert = result.edits.find(
    (edit) => edit.kind === "insert-result" && edit.start === caret,
  );
  const edits = selectedInsert ? [...formattingEdits, selectedInsert] : formattingEdits;
  const nextText = applyTapeEdits(source, edits);
  const nextCaret = selectionAfterEdits(caret, edits);
  return {
    handled: true,
    text: nextText,
    selectionStart: nextCaret,
    selectionEnd: nextCaret,
    result,
  };
}

export function applyBeforeInput(input) {
  if (input.inputType !== "insertLineBreak" && input.inputType !== "insertParagraph") {
    return null;
  }
  return applyEnter(input);
}

export function removeResultBlockAt({ text, selectionStart, settings = {} }) {
  const block = resultBlockAt(text, selectionStart);
  if (!block) return null;
  const source = `${text.slice(0, block.start)}${text.slice(block.end)}`;
  const result = calculateTape({ text: source, ...settings });
  const formattingEdits = result.edits.filter((edit) => edit.kind === "replace-token");
  return {
    handled: true,
    text: applyTapeEdits(source, formattingEdits),
    selectionStart: block.start,
    selectionEnd: block.start,
    result,
  };
}
