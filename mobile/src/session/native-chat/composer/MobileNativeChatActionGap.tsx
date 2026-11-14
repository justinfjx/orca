import type { ReactNode } from 'react'
import { View } from 'react-native'
import { ComposerUsageSlot } from '../../../composer-usage/ComposerUsageMeter'
import { composerInputStyles } from '../../../components/composer-input/composer-input-styles'

export function MobileNativeChatActionGap({
  agent,
  visible,
  ring
}: {
  agent: string | null
  visible: boolean
  ring: ReactNode
}): React.JSX.Element {
  return (
    <>
      {visible ? (
        <ComposerUsageSlot agent={agent} />
      ) : (
        <View style={composerInputStyles.actionSpacer} />
      )}
      {ring}
    </>
  )
}
