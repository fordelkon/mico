import {
  Button,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { FileTextIcon, MoonIcon, SettingsIcon } from 'lucide-react'
import { useState } from 'react'

const meta = {
  title: 'Components/Primitives/Command',
  component: Command,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs']
} satisfies Meta<typeof Command>

export default meta
type Story = StoryObj<typeof meta>

const commands = (
  <>
    <CommandInput placeholder="Search commands..." />
    <CommandList>
      <CommandEmpty>No commands found.</CommandEmpty>
      <CommandGroup heading="Appearance">
        <CommandItem value="light theme">
          <MoonIcon />
          Light theme
          <CommandShortcut>Light</CommandShortcut>
        </CommandItem>
        <CommandItem value="dark theme">
          <MoonIcon />
          Dark theme
          <CommandShortcut>Dark</CommandShortcut>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Navigation">
        <CommandItem>
          <FileTextIcon />
          New chat
          <CommandShortcut>⌘ N</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <SettingsIcon />
          Open settings
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </>
)

export const Default: Story = {
  render: () => <Command className="h-72 w-96 border">{commands}</Command>
}

export const Dialog: Story = {
  render: function CommandDialogStory() {
    const [open, setOpen] = useState(false)

    return (
      <>
        <Button onClick={() => setOpen(true)}>Open command palette</Button>
        <CommandDialog onOpenChange={setOpen} open={open}>
          {commands}
        </CommandDialog>
      </>
    )
  }
}
