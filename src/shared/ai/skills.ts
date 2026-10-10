import * as z from 'zod'

const SkillSourceSchema = z.enum(['project-agents', 'project-claude', 'user-agents', 'user-claude'])
const SkillIdSchema = z.string().trim().min(1).max(512)
const SkillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const ChatSkillInvocationPartSchema = z.strictObject({
  type: z.literal('data-skill-invocation'),
  data: z.strictObject({
    skillId: SkillIdSchema,
    name: SkillNameSchema,
    arguments: z
      .string()
      .refine((value) => new TextEncoder().encode(value).byteLength <= 64 * 1024, {
        message: 'Skill arguments must not exceed 64 KiB.'
      })
  })
})
const SkillCatalogRequestSchema = z.strictObject({ projectId: z.string().trim().min(1).optional() })
const SkillDocumentRequestSchema = z.strictObject({
  projectId: z.string().trim().min(1),
  skillId: SkillIdSchema
})
const SkillDocumentSchema = z.strictObject({ content: z.string(), body: z.string() })
const SkillCatalogSchema = z.object({
  skills: z.array(
    z.object({
      id: SkillIdSchema,
      name: SkillNameSchema,
      description: z.string().min(1).max(1024),
      source: SkillSourceSchema,
      userInvocable: z.boolean(),
      disableModelInvocation: z.boolean()
    })
  ),
  diagnostics: z.array(
    z.object({
      path: z.string(),
      message: z.string().min(1),
      source: SkillSourceSchema
    })
  )
})

type ChatSkillInvocationPart = z.infer<typeof ChatSkillInvocationPartSchema>
type SkillCatalog = z.infer<typeof SkillCatalogSchema>
type SkillSource = z.infer<typeof SkillSourceSchema>
type SkillDocument = z.infer<typeof SkillDocumentSchema>

export type { ChatSkillInvocationPart, SkillCatalog, SkillDocument, SkillSource }
export {
  ChatSkillInvocationPartSchema,
  SkillCatalogRequestSchema,
  SkillCatalogSchema,
  SkillDocumentRequestSchema,
  SkillDocumentSchema
}
