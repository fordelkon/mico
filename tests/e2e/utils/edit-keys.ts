/**
 * Native edit accelerators differ by platform: macOS uses the Cmd (Meta)
 * modifier and Cmd+Shift+Z for redo, while Windows/Linux use Ctrl (and
 * Ctrl+Y for redo). The composer keeps these gestures native, so scenarios
 * exercising undo/redo must send the accelerators of the host platform.
 */
const isMacOS = process.platform === 'darwin'
const modifier = isMacOS ? 'Meta' : 'Control'

export const editKeys = {
  undo: `${modifier}+z`,
  redo: isMacOS ? 'Meta+Shift+KeyZ' : 'Control+y',
  selectAll: `${modifier}+a`,
  copy: `${modifier}+c`,
  // The composer's token-aware word deletion accepts Ctrl and Cmd alike.
  deleteWord: `${modifier}+Backspace`
} as const
