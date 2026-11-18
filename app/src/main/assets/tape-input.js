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

  let source = `${text.slice(0, selectionStart)}\n${text.slice(selectionEnd)}`;
  const caret = selectionStart + 1;
  let result = calculateTape({ text: source, ...settings });
  let selectedInsert = result.edits.find(
    (edit) => edit.kind === "insert-result" && edit.start === caret,
  );
  const lineEnd = text.indexOf("\n", selectionEnd);
  const remainderEnd = lineEnd < 0 ? text.length : lineEnd;
  if (selectedInsert && remainderEnd > selectionEnd) {
    // Match upstream Sciter: materializing a total replaces the remainder of
    // the active line rather than joining those characters to the result.
    source = `${text.slice(0, selectionStart)}\n${text.slice(remainderEnd)}`;
    result = calculateTape({ text: source, ...settings });
    selectedInsert = result.edits.find(
      (edit) => edit.kind === "insert-result" && edit.start === caret,
    );
  }
  const formattingEdits = result.edits.filter((edit) => edit.kind === "replace-token");
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

export function bindHistoryControl(button, direction, restore) {
  const keepEditorFocus = (event) => event.preventDefault();
  button.addEventListener("pointerdown", keepEditorFocus);
  button.addEventListener("mousedown", keepEditorFocus);
  button.addEventListener("click", () => restore(direction));
}

export function runInputRecalculation(recalculate, report = console.error) {
  try {
    return recalculate();
  } catch (error) {
    report("QwikTape input recalculation failed; editor text was preserved.", error);
    return null;
  }
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
