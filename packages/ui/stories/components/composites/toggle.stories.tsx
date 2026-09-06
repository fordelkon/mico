import { Toggle } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useArgs } from 'storybook/preview-api'

const meta = {
  title: 'Components/Composites/Toggle',
  component: Toggle,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  args: {
    'aria-label': 'Enable notifications',
    checked: false,
    onCheckedChange: () => undefined
  }
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

export const Off: Story = {}

export const On: Story = {
  args: {
    checked: true
  }
}

export const Disabled: Story = {
  args: {
    disabled: true
  }
}

export const Interactive: Story = {
  render: function Render(args) {
    const [{ checked }, updateArgs] = useArgs()

    return (
      <Toggle
        {...args}
        checked={checked}
        onCheckedChange={(nextChecked) => updateArgs({ checked: nextChecked })}
      />
    )
  }
}
