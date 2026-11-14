/** Removes provider-emitted thinking tags from plain-text title and summary output. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
}

export { stripThinking }
