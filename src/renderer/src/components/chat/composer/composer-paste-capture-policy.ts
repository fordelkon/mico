/**
 * Long-paste policy for the composer.
 *
 * The draft keeps short visible token labels; the full text lives in the
 * draft's paste token metadata and is expanded when a message is sent or
 * copied. The policy only decides when a paste is large enough to capture as
 * a token instead of staying ordinary textarea text.
 */
export const PastedTextCaptureMinChars = 1_000
export const PastedTextCaptureMinLines = 10

export function shouldCapturePastedText(text: string | undefined | null): text is string {
  if (!text) return false
  if (text.length >= PastedTextCaptureMinChars) return true
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && ++lines > PastedTextCaptureMinLines) return true
  }
  return false
}
