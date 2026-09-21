import { describe, expect, it } from 'vitest'

import { sortByEnabledOrder } from './enabled-order'

describe('sortByEnabledOrder', () => {
  it('user sees enabled items first when sorting, then disabled items keep their order', () => {
    const items = [{ id: 'ollama' }, { id: 'custom-a' }, { id: 'custom-b' }]

    expect(sortByEnabledOrder(items, ['custom-a', 'ollama'], (item) => item.id)).toEqual([
      { id: 'custom-a' },
      { id: 'ollama' },
      { id: 'custom-b' }
    ])
  })
})
