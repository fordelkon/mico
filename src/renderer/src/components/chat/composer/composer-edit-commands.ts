/**
 * The browser transaction seam for composer editing. Real Chromium applies
 * these commands through its editing stack, so native undo/redo (Ctrl+Z /
 * Ctrl+Shift+Z) covers completion insertion and atomic token deletion exactly
 * like ordinary typing. jsdom has no execCommand; tests stub this document API
 * at the browser boundary instead of faking undo in production code.
 */
function deleteTextareaRange(textarea: HTMLTextAreaElement, start: number, end: number): void {
  textarea.setSelectionRange(start, end)
  document.execCommand('delete')
}

function insertTextareaText(text: string): void {
  document.execCommand('insertText', false, text)
}

export { deleteTextareaRange, insertTextareaText }
