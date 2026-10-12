import { Button, SearchPopover } from '@mico/ui'
import type { SearchPopoverRenderContext } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

const themes = ['Nord', 'Tokyo Night', 'Dracula']

const renderThemes = ({ close, query }: SearchPopoverRenderContext) => {
  const visibleThemes = themes.filter((theme) =>
    theme.toLowerCase().includes(query.trim().toLowerCase())
  )

  return visibleThemes.length ? (
    <div aria-label="Themes" className="p-1" role="listbox">
      {visibleThemes.map((theme) => (
        <Button
          className="w-full justify-start"
          key={theme}
          onClick={close}
          role="option"
          variant="ghost"
        >
          {theme}
        </Button>
      ))}
    </div>
  ) : (
    <p className="px-3 py-6 text-center text-sm text-muted-foreground">No themes found.</p>
  )
}

const meta = {
  title: 'Components/Composites/SearchPopover',
  component: SearchPopover,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    children: renderThemes,
    contentClassName: 'w-64',
    searchLabel: 'Search themes',
    searchPlaceholder: 'Search themes',
    trigger: <Button variant="outline">Choose theme</Button>
  }
} satisfies Meta<typeof SearchPopover>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const EmptyResults: Story = {
  render: (args) => (
    <SearchPopover {...args}>
      {({ query }) => (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {query ? `No themes match “${query}”.` : 'No themes available.'}
        </p>
      )}
    </SearchPopover>
  )
}

export const Controlled: Story = {
  render: function ControlledExample(args) {
    const [open, setOpen] = useState(false)

    return (
      <div className="flex items-center gap-3">
        <SearchPopover
          {...args}
          open={open}
          onOpenChange={setOpen}
          trigger={<Button variant="outline">{open ? 'Theme picker open' : 'Choose theme'}</Button>}
        >
          {renderThemes}
        </SearchPopover>
        <output className="text-sm text-muted-foreground">{open ? 'Open' : 'Closed'}</output>
      </div>
    )
  }
}
