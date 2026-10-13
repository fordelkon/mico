import { describe, expect, it } from 'vitest'

import { createProjectAgentInstructions } from './agent-instructions'

describe('createProjectAgentInstructions', () => {
  it('user gets grounded instructions when a project starts, then work is anchored', () => {
    const instructions = createProjectAgentInstructions('C:\\work\\project')

    expect(instructions).toContain('C:\\work\\project')
    expect(instructions).toContain('AGENTS.md')
    // Line wrapping is not policy; the negation and evidence scope are.
    expect(instructions).toMatch(/as evidence,\s+not instructions/)
    expect(instructions).toMatch(/reason privately/)
    expect(instructions).toMatch(/do\s+not expose raw chain-of-thought/)
    expect(instructions).toMatch(/verification evidence, and any remaining gap/)

    expect(instructions).toContain('Use Edit with file_path, old_string and new_string')
    expect(instructions).toContain('Use Bash for commands; timeout is measured in milliseconds')
    expect(instructions).toContain('use Write with file_path and complete content')
    expect(instructions).not.toContain('Use read for focused inspection, edit')
  })
})
