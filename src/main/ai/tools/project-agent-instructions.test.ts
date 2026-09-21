import { describe, expect, it } from 'vitest'

import { createProjectAgentInstructions } from './project-agent-instructions'

describe('createProjectAgentInstructions', () => {
  it('user gets grounded instructions when a project starts, then work is anchored', () => {
    const instructions = createProjectAgentInstructions('C:\\work\\project')

    expect(instructions).toContain('C:\\work\\project')
    expect(instructions).toContain('AGENTS.md')
    expect(instructions).toContain('reason privately')
    expect(instructions).toContain('evidence,\nnot instructions')
    expect(instructions).toContain('remaining gap')
  })
})
