import { QwikTape, safeErrorText } from "./tape-parser.js";

const RESULT_SEPARATOR = "═";
const EXTENSION_ERROR_PLACEHOLDER = "?";

function styleList(style) {
  if (style === undefined) return [];
  return Array.isArray(style) ? [...style] : [style];
}

function decimalText(value) {
  return value?.toString?.() ?? String(value);
}

function extensionText(token, extension, decimalDigits, padding) {
  if (!token?.extensionValue) return decimalText(token?.value);
  try {
    const adapter = extension?.valueAdapter;
    if (typeof adapter?.fixedValue !== "function") {
      throw new TypeError("extension.valueAdapter.fixedValue is required");
    }
    return String(adapter.fixedValue(token.value, {decimalDigits, padding}));
  }
  catch(error) {
    token.style = ["ErrorLiteral", "Error"];
    token.tooltip = token.tooltip ? `${token.tooltip}\n${safeErrorText(error)}` : safeErrorText(error);
    return EXTENSION_ERROR_PLACEHOLDER;
  }
}

function extensionVariableText(name, value, parser, extension, decimalDigits, padding, diagnostics) {
  if (!parser._varExtensions[name]) return decimalText(value);
  try {
    const adapter = extension?.valueAdapter;
    if (typeof adapter?.fixedValue !== "function") {
      throw new TypeError("extension.valueAdapter.fixedValue is required");
    }
    return String(adapter.fixedValue(value, {decimalDigits, padding}));
  } catch (error) {
    diagnostics.push({
      kind: "evaluation",
      message: safeErrorText(error),
      variable: name,
    });
    return EXTENSION_ERROR_PLACEHOLDER;
  }
}

function publicToken(token, extension, decimalDigits, padding) {
  const value = token.value === undefined
    ? undefined
    : extensionText(token, extension, decimalDigits, padding);
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
    value,
  };
}

function publicError(error, extension, decimalDigits, padding) {
  return {
    kind: "parser",
    name: error.name,
    message: error.message,
    token: error.token
      ? publicToken(error.token, extension, decimalDigits, padding)
      : undefined,
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
    node: {
      startOffset: edit.node.startOffset,
      endOffset: edit.node.endOffset,
      startLine: edit.node.startLine,
      startColumn: edit.node.startColumn,
      endLine: edit.node.endLine,
      endColumn: edit.node.endColumn,
    },
  };
}

function formattingEdit(token, source) {
  const whitespace = token.ws ?? 0;
  const padding = token.padding ?? 0;
  const value = token.formatting ?? token.image;
  const lineStart = token.startOffset - Math.max(0, (token.startColumn ?? 1) - 1);
  let start = Math.max(lineStart, token.startOffset - whitespace);
  for (let offset = token.startOffset - 1; offset >= start; offset -= 1) {
    if (source[offset] !== " " && source[offset] !== "\t") {
      start = offset + 1;
      break;
    }
  }
  return {
    kind: "replace-token",
    line: token.startLine,
    start,
    end: token.endOffset + 1,
    value,
    replacement: `${" ".repeat(Math.max(0, whitespace + padding))}${value}`,
  };
}

function engineFailure(_error, lex) {
  let tokens = [];
  try { tokens = (lex?.tokens ?? []).map(publicToken); } catch (_tokenError) { /* no-op */ }

  return {
    edits: [],
    tokens,
    diagnostics: [{
      kind: "engine",
      name: "EngineError",
      message: "The tape could not be recalculated. Your text was preserved.",
    }],
    variables: {},
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
  extension = null,
} = {}) {
  let lex;
  let runtime;
  try {
    const source = typeof text === "string" ? text : String(text ?? "");
    const safeDigits = Math.min(50, Math.max(0, Number(decimalDigits) || 0));
    const safePadding = Math.max(1, Number(padding) || 1);
    QwikTape.changeLocale(locale, safeDigits);
    runtime = QwikTape.selectRuntime(extension);

    let ast;
    try {
      lex = runtime.lexer.tokenize(source);
      runtime.parser.input = lex.tokens;
      ast = runtime.parser.tape({
        decimalDigits: safeDigits,
        padding: safePadding,
        extension,
      }) ?? [];
    } finally {
      QwikTape.clearExtension();
    }

    const tokens = lex.tokens.map((token) => publicToken(
      token,
      extension,
      safeDigits,
      safePadding,
    ));
    const edits = [
      ...lex.tokens
        .filter((token) => token.formatting !== undefined || token.padding !== undefined)
        .map((token) => formattingEdit(token, source)),
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
    const adapterDiagnostics = [];
    const variables = Object.fromEntries(
      Object.entries(runtime.parser._vars).map(([name, value]) => [
        name,
        extensionVariableText(
          name,
          value,
          runtime.parser,
          extension,
          safeDigits,
          safePadding,
          adapterDiagnostics,
        ),
      ]),
    );
    const diagnostics = [
      ...lex.errors.map((error) => ({
        kind: "lexer",
        name: error.name,
        message: error.message,
        offset: error.offset,
      })),
      ...runtime.parser.errors.map((error) => publicError(
        error,
        extension,
        safeDigits,
        safePadding,
      )),
      ...(extension ? QwikTape.extensionDiagnostics() : []),
      ...tokenDiagnostics,
      ...adapterDiagnostics,
    ];

    return { edits, tokens, diagnostics, variables };
  } catch (error) {
    QwikTape.clearExtension();
    return engineFailure(error, lex);
  }
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
