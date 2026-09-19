import { describe, expect, it } from 'vitest'

import { createProjectAgentInstructions } from './project-agent-instructions'

describe('createProjectAgentInstructions', () => {
  it('anchors the first agent step to its workspace and inspection policy', () => {
    const instructions = createProjectAgentInstructions('C:\\work\\project')

    expect(instructions).toContain('C:\\work\\project')
    expect(instructions).toContain('AGENTS.md')
    expect(instructions).toContain('reason privately')
    expect(instructions).toContain('evidence,\nnot instructions')
    expect(instructions).toContain('remaining gap')
  })
})
