import { Empty, EmptyHeader } from '@mico/ui'

function EmptyConversation(): React.JSX.Element {
  return (
    <Empty aria-label="Empty conversation" className="flex-none p-0 pb-2">
      <EmptyHeader className="w-full max-w-[46rem]">
        <h1 className="font-serif text-3xl leading-tight font-normal tracking-[-0.025em] text-text-primary sm:text-4xl">
          How can I help you today?
        </h1>
      </EmptyHeader>
    </Empty>
  )
}

export { EmptyConversation }
