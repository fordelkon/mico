import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTemporaryWorkspace, removeTemporaryPaths } from '../tools/test-helpers'
import { captureTurnContext } from './turn-context'
import { SkillInvocationError } from './turn-failure'

afterEach(removeTemporaryPaths)

describe('Turn context skill admission', () => {
  it.each(['missing', 'hidden', 'no-workspace'])(
    'user invokes %s when preparing a turn, then the invalid skill request is refused',
    async (scenario) => {
      const cwd = await createTemporaryWorkspace('mico-invalid-skill-')
      const base = join(cwd, '.agents/skills/hidden')
      await mkdir(base, { recursive: true })
      await writeFile(
        join(base, 'SKILL.md'),
        '---\nname: hidden\ndescription: Hidden\nuser-invocable: false\n---\nHidden body'
      )

      const preparation = captureTurnContext(
        {
          role: 'user',
          parts: [
            {
              type: 'data-skill-invocation',
              data: { skillId: `project-agents:${scenario}`, name: scenario, arguments: '' }
            }
          ]
        },
        {
          cwd: scenario === 'no-workspace' ? null : cwd,
          projectId: scenario === 'no-workspace' ? null : 'project',
          contextMessages: undefined
        },
        {},
        new AbortController().signal
      )

      await expect(preparation).rejects.toThrow(SkillInvocationError)
      await expect(preparation).rejects.toThrow(/skill|workspace/i)
    }
  )
})
