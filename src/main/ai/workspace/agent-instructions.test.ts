import { describe, expect, it } from 'vitest'

import { createProjectAgentInstructions } from './agent-instructions'

describe('createProjectAgentInstructions', () => {
  it('user gets grounded instructions when a project starts, then work is anchored', () => {
    const instructions = createProjectAgentInstructions('C:\\work\\project')

    // Grounding: the workspace root and attributed user context anchor the instructions.
    expect(instructions).toContain('C:\\work\\project')
    expect(instructions).toContain('AGENTS.md')
    // Evidence scoping: file contents are evidence, not instructions, regardless of wrapping.
    expect(instructions).toMatch(/evidence[\s\S]*not instructions/)
    // Private reasoning: reasoning stays private and raw chain-of-thought is not exposed.
    expect(instructions).toMatch(/privately[\s\S]*chain-of-thought/)
    // Reporting: verification evidence plus outstanding gaps.
    expect(instructions).toMatch(/verification[\s\S]*gap/)
    // External protocol: tool parameter names and the Bash timeout unit the model must obey.
    expect(instructions).toContain('Use Edit with file_path, old_string and new_string')
    expect(instructions).toContain('Use Bash for commands; timeout is measured in milliseconds')
    expect(instructions).toContain('use Write with file_path and complete content')
    // Negative control: the legacy combined tool phrasing must not leak into the protocol.
    expect(instructions).not.toContain('Use read for focused inspection, edit')
  })
})
