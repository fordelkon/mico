import { expect, test } from '@playwright/test'

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
