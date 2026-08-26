import { Empty, EmptyHeader, EmptyTitle } from '@mico/ui'

function EmptyConversation(): React.JSX.Element {
  return (
    <Empty aria-label="Empty conversation" className="flex-none border-0 p-0 pb-2">
      <EmptyHeader className="w-full max-w-[46rem] gap-0">
        <EmptyTitle className="font-serif text-3xl leading-none font-normal tracking-[-0.025em] text-primary sm:text-4xl">
          How can I help you today?
        </EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}

export { EmptyConversation }
