import * as z from 'zod'

/** Approximate application-visible input projection, never model or wire usage. */
const ContextMeasurementSchema = z.object({
  policyId: z.literal('unicode-heuristic-v1'),
  estimatedInputTokens: z.number().int().nonnegative().finite(),
  schemaTruncated: z.boolean().optional()
})

type ContextMeasurement = z.infer<typeof ContextMeasurementSchema>

export { type ContextMeasurement, ContextMeasurementSchema }
