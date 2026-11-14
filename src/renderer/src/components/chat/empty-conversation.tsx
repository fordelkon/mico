import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@mico/ui'

function EmptyConversation(): React.JSX.Element {
  return (
    <Empty aria-label="Empty conversation" className="flex-none p-0 pb-2">
      <EmptyHeader className="w-full max-w-[46rem] gap-3">
        <EmptyTitle className="font-serif text-3xl leading-tight font-normal tracking-[-0.025em] text-text-primary sm:text-4xl">
          How can I help you today?
        </EmptyTitle>
        <EmptyDescription className="text-sm text-text-secondary">
          Explore an idea, ask a question, or work on something together.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export { EmptyConversation }
