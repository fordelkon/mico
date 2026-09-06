import type { CustomProvider } from '@shared/data/schemas/provider'
import { BoxesIcon, CloudIcon, ServerIcon, TerminalIcon } from 'lucide-react'
import * as React from 'react'

import lmStudioIcon from '@renderer/assets/providers/lmstudio.svg'
import ollamaDarkIcon from '@renderer/assets/providers/ollama-dark.svg'
import ollamaLightIcon from '@renderer/assets/providers/ollama-light.svg'

import { customProviderLogoSources } from './custom-provider-logo-icons'

const customProviderLogoSourcesById = new Map<string, string>(
  customProviderLogoSources.map(({ id, source }) => [id, source])
)

function ProviderIcon({
  className = 'size-6 rounded-sm',
  customIcon,
  providerId
}: {
  className?: string
  customIcon?: CustomProvider['icon']
  providerId: string
}): React.JSX.Element {
  if (providerId === 'lm-studio') {
    return <img alt="" aria-hidden="true" className={className} src={lmStudioIcon} />
  }
  if (providerId === 'ollama') {
    return (
      <>
        <img
          alt=""
          aria-hidden="true"
          className={`${className} dark:hidden`}
          src={ollamaLightIcon}
        />
        <img
          alt=""
          aria-hidden="true"
          className={`hidden ${className} dark:block`}
          src={ollamaDarkIcon}
        />
      </>
    )
  }

  switch (customIcon) {
    case 'cloud':
      return <CloudIcon aria-hidden="true" className={className} />
    case 'server':
      return <ServerIcon aria-hidden="true" className={className} />
    case 'terminal':
      return <TerminalIcon aria-hidden="true" className={className} />
    case 'default':
      return <BoxesIcon aria-hidden="true" className={className} />
    default: {
      const source = customIcon ? customProviderLogoSourcesById.get(customIcon) : undefined

      return source ? (
        <img alt="" aria-hidden="true" className={className} src={source} />
      ) : (
        <BoxesIcon aria-hidden="true" className={className} />
      )
    }
  }
}

export { ProviderIcon }
