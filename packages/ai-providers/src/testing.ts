import type {
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ProviderPerformanceMetrics,
  ProviderTestResult
} from './contracts'
import { createChatProvider } from './index'

type ProviderTestDependencies = ChatProviderDependencies & {
  now?: () => number
}

function getCurrentTime(): number {
  return performance.now()
}

function isGeneratedToken(chunk: { type: string }): boolean {
  return chunk.type === 'reasoning-delta' || chunk.type === 'text-delta'
}

async function testChatProvider(
  configuration: ChatProviderConfiguration,
  dependencies: ProviderTestDependencies
): Promise<ProviderTestResult> {
  const { now = getCurrentTime, ...providerDependencies } = dependencies
  const startedAt = now()
  let firstTokenAt: number | undefined
  let reportedMetrics: ProviderPerformanceMetrics | undefined
  const provider = createChatProvider(configuration, providerDependencies)
  const stream = await provider.stream({
    collectPerformanceMetrics: true,
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Reply with OK.' }] }],
    thinkingEffort: 'default',
    signal: new AbortController().signal,
    onPerformanceMetrics: (metrics) => {
      reportedMetrics = { ...reportedMetrics, ...metrics }
    }
  })

  for await (const chunk of stream) {
    if (firstTokenAt === undefined && isGeneratedToken(chunk)) firstTokenAt = now()
  }

  const durationMs = now() - startedAt
  const timeToFirstTokenMs =
    reportedMetrics?.timeToFirstTokenMs ??
    (firstTokenAt === undefined ? undefined : firstTokenAt - startedAt)
  const generationDurationMs =
    timeToFirstTokenMs === undefined ? undefined : durationMs - timeToFirstTokenMs
  const tokensPerSecond =
    reportedMetrics?.tokensPerSecond ??
    (reportedMetrics?.outputTokens && generationDurationMs && generationDurationMs > 0
      ? (reportedMetrics.outputTokens * 1_000) / generationDurationMs
      : undefined)

  const result: ProviderTestResult = { durationMs }
  if (reportedMetrics?.outputTokens !== undefined)
    result.outputTokens = reportedMetrics.outputTokens
  if (timeToFirstTokenMs !== undefined) result.timeToFirstTokenMs = timeToFirstTokenMs
  if (tokensPerSecond !== undefined) result.tokensPerSecond = tokensPerSecond
  return result
}

export { testChatProvider }
export type { ProviderTestDependencies }
