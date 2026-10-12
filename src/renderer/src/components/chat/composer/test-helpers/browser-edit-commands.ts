import { fireEvent } from '@testing-library/react'

/**
 * jsdom implements no `document.execCommand`, so the composer's browser
 * transaction seam cannot execute as-is. This stub emulates the two textarea
 * commands the composer uses at the document boundary Chromium owns: it
 * applies the edit to the focused textarea with the native value setter and
 * dispatches the resulting input event, so React state and caret expectations
 * follow the real edit flow. It cannot emulate native undo stacks; those are
 * verified by the Electron end-to-end scenario.
 */
export function stubBrowserEditCommands(): void {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: (command: string, _ui?: boolean, value?: string): boolean => {
      const textarea = document.activeElement
      if (!(textarea instanceof HTMLTextAreaElement)) return false
      const start = textarea.selectionStart ?? textarea.value.length
      const end = textarea.selectionEnd ?? start
      if (command === 'delete') {
        textarea.setRangeText('', start, end, 'end')
        fireEvent.input(textarea)
        return true
      }
      if (command === 'insertText' && value !== undefined) {
        textarea.setRangeText(value, start, end, 'end')
        fireEvent.input(textarea)
        return true
      }
      return false
    }
  })
}
