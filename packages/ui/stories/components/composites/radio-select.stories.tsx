import { RadioSelect } from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useArgs } from 'storybook/preview-api'

const options = [
  { label: 'Auto', value: 'auto' },
  { label: 'GitHub Dark', value: 'github-dark' },
  { label: 'Dracula', value: 'dracula' }
] as const

const meta = {
  component: RadioSelect,
  title: 'Components/Composites/RadioSelect',
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  args: {
    'aria-label': 'Code theme',
    onValueChange: () => undefined,
    options,
    value: 'auto'
  }
} satisfies Meta<typeof RadioSelect>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const OpensAbove: Story = {
  args: { side: 'top', align: 'end', sideOffset: 8 }
}

export const LongLabel: Story = {
  args: {
    options: [
      {
        label: 'Anthropic Messages (v1/messages)',
        value: 'anthropic-compatible'
      }
    ],
    value: 'anthropic-compatible'
  }
}

export const Interactive: Story = {
  render: function Render(args) {
    const [{ value }, updateArgs] = useArgs()

    return (
      <RadioSelect
        {...args}
        onValueChange={(nextValue) => updateArgs({ value: nextValue })}
        value={value}
      />
    )
  }
}

export const Disabled: Story = {
  args: {
    disabled: true
  }
}
