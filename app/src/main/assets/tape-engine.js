import { QwikTape } from "./tape-parser.js";

const RESULT_SEPARATOR = "═";

function styleList(style) {
  if (style === undefined) return [];
  return Array.isArray(style) ? [...style] : [style];
}

function decimalText(value) {
  return value?.toString?.() ?? String(value);
}

function publicToken(token) {
  return {
    type: token.tokenType?.name,
    image: token.image,
    startOffset: token.startOffset,
    endOffset: token.endOffset,
    startLine: token.startLine,
    startColumn: token.startColumn,
    endLine: token.endLine,
    endColumn: token.endColumn,
    formatting: token.formatting,
    padding: token.padding,
    whitespace: token.ws,
    styles: styleList(token.style),
    tooltip: token.tooltip === undefined ? undefined : String(token.tooltip),
    value: token.value === undefined ? undefined : decimalText(token.value),
  };
}

function publicError(error) {
  return {
    kind: "parser",
    name: error.name,
    message: error.message,
    token: error.token ? publicToken(error.token) : undefined,
  };
}

function resultInsert(edit) {
  const width = Math.max(edit.padding ?? 0, edit.value.length);
  return {
    kind: "insert-result",
    start: edit.node.endOffset + 1,
    end: edit.node.endOffset + 1,
    value: edit.value,
    width,
    replacement: `${RESULT_SEPARATOR.repeat(width)}\n${edit.value.padStart(width, " ")}`,
  };
}

function formattingEdit(token) {
  const whitespace = token.ws ?? 0;
  const padding = token.padding ?? 0;
  const value = token.formatting ?? token.image;
  return {
    kind: "replace-token",
    line: token.startLine,
    start: Math.max(0, token.startOffset - whitespace),
    end: token.endOffset + 1,
    value,
    replacement: `${" ".repeat(Math.max(0, whitespace + padding))}${value}`,
  };
}

/**
 * Pure tape calculation boundary shared by the Android DOM shell and tests.
 * It performs no DOM, storage, Android, print, or construction-unit work.
 */
export function calculateTape({
  text,
  locale = "1,234,567.89",
  decimalDigits = 2,
  padding = 10,
}) {
  const safeDigits = Math.min(50, Math.max(0, Number(decimalDigits) || 0));
  const safePadding = Math.max(1, Number(padding) || 1);
  QwikTape.changeLocale(locale, safeDigits);

  const lex = QwikTape.lexer.tokenize(text);
  QwikTape.parser.input = lex.tokens;
  const ast = QwikTape.parser.tape({ decimalDigits: safeDigits, padding: safePadding });

  const tokens = lex.tokens.map(publicToken);
  const edits = [
    ...lex.tokens
      .filter((token) => token.formatting !== undefined || token.padding !== undefined)
      .map(formattingEdit),
    ...ast
      .filter((edit) => edit?.type === QwikTape.tokenType.Insert)
      .map(resultInsert),
  ];

  const tokenDiagnostics = tokens
    .filter((token) => token.styles.includes("Error"))
    .map((token) => ({
      kind: "evaluation",
      message: token.tooltip || "Invalid tape value",
      token,
    }));

  const diagnostics = [
    ...lex.errors.map((error) => ({
      kind: "lexer",
      name: error.name,
      message: error.message,
      offset: error.offset,
    })),
    ...QwikTape.parser.errors.map(publicError),
    ...tokenDiagnostics,
  ];

  const variables = Object.fromEntries(
    Object.entries(QwikTape.parser._vars).map(([name, value]) => [name, decimalText(value)]),
  );

  return { edits, tokens, diagnostics, variables };
}

export function applyTapeEdits(text, edits) {
  const operations = [...edits]
    .sort((left, right) => right.start - left.start || right.end - left.end);
  return operations.reduce(
    (next, edit) => `${next.slice(0, edit.start)}${edit.replacement}${next.slice(edit.end)}`,
    text,
  );
}

export function resultBlockAt(text, offset) {
  const lines = text.split("\n");
  let position = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const end = position + lines[index].length;
    if (offset >= position && offset <= end) {
      const separatorIndex = /^═+$/.test(lines[index])
        ? index
        : index > 0 && /^═+$/.test(lines[index - 1]) ? index - 1 : -1;
      if (separatorIndex < 0 || separatorIndex + 1 >= lines.length) return null;
      const start = lines.slice(0, separatorIndex).reduce((sum, line) => sum + line.length + 1, 0);
      const blockEnd = start + lines[separatorIndex].length + 1 + lines[separatorIndex + 1].length;
      return { start, end: blockEnd, separatorIndex, resultIndex: separatorIndex + 1 };
    }
    position = end + 1;
  }
  return null;
}

export { RESULT_SEPARATOR };
