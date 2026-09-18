import { describe, expect, it } from 'vitest'

import { sortByEnabledOrder } from './enabled-order'

describe('sortByEnabledOrder', () => {
  it('places enabled items first in activation order while preserving the disabled order', () => {
    const items = [{ id: 'ollama' }, { id: 'custom-a' }, { id: 'custom-b' }]

    expect(sortByEnabledOrder(items, ['custom-a', 'ollama'], (item) => item.id)).toEqual([
      { id: 'custom-a' },
      { id: 'ollama' },
      { id: 'custom-b' }
    ])
  })
})
