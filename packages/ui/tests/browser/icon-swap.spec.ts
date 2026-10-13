import { expect, test } from '@playwright/test'

test('user switches icons when motion is enabled, then both icons fade and scale through intermediate states', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/iframe.html?id=components-composites-iconswap--interactive&viewMode=story')
  const samples = await page
    .getByRole('button', { name: 'Show To icon' })
    .evaluate(async (button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error('The toggle button is missing.')
      const swap = document.querySelector('[data-slot="icon-swap"]')
      if (!swap) throw new Error('The icon swap is missing.')
      const icons = Array.from(swap.children)
      // Establish the starting style before the real story changes its state.
      icons.forEach((icon) => getComputedStyle(icon).scale)
      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (swap.getAttribute('data-state') !== 'to') return
          observer.disconnect()
          resolve()
        })
        observer.observe(swap, { attributes: true, attributeFilter: ['data-state'] })
        button.click()
      })
      return icons.map((icon) => {
        // Seek the browser-created transitions instead of racing the animation clock.
        void getComputedStyle(icon).scale
        const transitions = icon
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
        for (const transition of transitions) {
          transition.pause()
          transition.currentTime = Number(transition.effect?.getTiming().duration) / 2
        }
        const style = getComputedStyle(icon)
        const sample = {
          properties: transitions.map((transition) => transition.transitionProperty).sort(),
          opacity: Number(style.opacity),
          scale: Number.parseFloat(style.scale)
        }
        transitions.forEach((transition) => transition.finish())
        return sample
      })
    })

  expect(samples).toHaveLength(2)
  for (const sample of samples) {
    expect(sample.properties).toEqual(['opacity', 'scale'])
    expect(sample.opacity).toBeGreaterThan(0)
    expect(sample.opacity).toBeLessThan(1)
    expect(sample.scale).toBeGreaterThan(0.6)
    expect(sample.scale).toBeLessThan(1)
  }
})

test('user switches icons when reduced motion is requested, then the final state appears without transitions', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/iframe.html?id=components-composites-iconswap--interactive&viewMode=story')
  await page.getByRole('button', { name: 'Show To icon' }).click()
  const swap = page.locator('[data-slot="icon-swap"]')
  const fromIcon = swap.locator('> span').nth(0)
  const toIcon = swap.locator('> span').nth(1)

  await expect(fromIcon).toHaveCSS('opacity', '0')
  await expect(fromIcon).toHaveCSS('scale', '0.6')
  await expect(toIcon).toHaveCSS('opacity', '1')
  await expect(toIcon).toHaveCSS('scale', '1')
  expect(await swap.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
})

test('user switches icons when toggling the state, then only the matching icon is opaque and full size', async ({
  page
}) => {
  await page.goto('/iframe.html?id=components-composites-iconswap--interactive&viewMode=story')

  // The icons are decorative; their wrappers own the rendered opacity and scale.
  const swap = page.locator('[data-slot="icon-swap"]')
  const fromIcon = swap.locator('> span').nth(0)
  const toIcon = swap.locator('> span').nth(1)

  await expect(fromIcon).toHaveCSS('opacity', '1')
  // Tailwind v4 uses the individual scale property, not the transform matrix.
  await expect(fromIcon).toHaveCSS('scale', /^(none|1)$/)
  await expect(toIcon).toHaveCSS('opacity', '0')
  await expect(toIcon).toHaveCSS('scale', '0.6')

  await page.getByRole('button', { name: 'Show To icon' }).click()

  await expect(fromIcon).toHaveCSS('opacity', '0')
  await expect(fromIcon).toHaveCSS('scale', '0.6')
  await expect(toIcon).toHaveCSS('opacity', '1')
  await expect(toIcon).toHaveCSS('scale', '1')

  await page.getByRole('button', { name: 'Show From icon' }).click()

  await expect(fromIcon).toHaveCSS('opacity', '1')
  await expect(fromIcon).toHaveCSS('scale', /^(none|1)$/)
  await expect(toIcon).toHaveCSS('opacity', '0')
  await expect(toIcon).toHaveCSS('scale', '0.6')
})
