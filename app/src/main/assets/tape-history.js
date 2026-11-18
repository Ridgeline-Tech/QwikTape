export class TapeHistory {
  constructor(initialText = "") {
    this.current = initialText;
    this.undoStack = [];
    this.redoStack = [];
  }

  commit(text) {
    if (text === this.current) return this.current;
    this.undoStack.push(this.current);
    this.current = text;
    this.redoStack = [];
    return this.current;
  }

  replaceCurrent(text) {
    this.current = text;
    return this.current;
  }

  undo() {
    if (this.undoStack.length === 0) return this.current;
    this.redoStack.push(this.current);
    this.current = this.undoStack.pop();
    return this.current;
  }

  redo() {
    if (this.redoStack.length === 0) return this.current;
    this.undoStack.push(this.current);
    this.current = this.redoStack.pop();
    return this.current;
  }
}
