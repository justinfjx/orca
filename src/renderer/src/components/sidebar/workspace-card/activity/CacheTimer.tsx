import { useAppStore } from '@/store/index'
import { cn } from '@/lib/class-names'
import { Timer } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useShallow } from 'zustand/react/shallow'
import { useCallback, useMemo } from 'react'
import { useAppStateView } from '@/store/retained-views/app-state-view'
import { useAgentStatusSelector } from '@/runtime/agent-status/use-agent-status'
import { usePromptCacheCountdownNow } from './prompt-cache-countdown-clock'
import {
  getMostUrgentPromptCacheStartedAt,
  getPromptCacheCountdownForPane,
  getStructuredPromptCacheStartedAt,
  type PromptCacheCountdownSelection
} from './prompt-cache-timer-selection'
import { useTranslate } from '@/i18n/use-translate'
import { getStructuredAgentSessionTabsByPaneKey } from '@/components/native-chat/session/status/structured-agent-session-tabs'
import { selectLiveAgentStatusEntriesForWorktree } from './worktree-agent-row-selectors'
import { useAgentPresentation } from './useWorktreeAgentRows'

/** Resolve the soonest-expiring Claude cache once for both row visibility and countdown rendering. */
export function usePromptCacheCountdownStartedAt(worktreeId: string, active = true): number | null {
  const store = useAppStateView()
  const [enabled, ttlMs, terminalStartedAt] = useAppStore(
    useShallow((s) => {
      if (!active) {
        return [false, 0, null] as const
      }
      const enabled = s.settings?.promptCacheTimerEnabled ?? false
      const ttlMs = s.settings?.promptCacheTtlMs ?? 0
      if (!enabled || ttlMs <= 0) {
        return [enabled, ttlMs, null] as const
      }
      return [
        enabled,
        ttlMs,
        getMostUrgentPromptCacheStartedAt(s.tabsByWorktree[worktreeId], s.cacheTimerByKey)
      ] as const
    })
  )
  const nativeStartedAt = useAgentPresentation(
    `list\0${worktreeId}`,
    useCallback(() => {
      if (!enabled || ttlMs <= 0) {
        return null
      }
      const s = store.getState()
      let startedAt: number | null = null
      const structuredTabs = getStructuredAgentSessionTabsByPaneKey(s.unifiedTabsByWorktree)
      for (const entry of selectLiveAgentStatusEntriesForWorktree(s, worktreeId)) {
        if (!structuredTabs.has(entry.paneKey)) {
          continue
        }
        const candidate = getStructuredPromptCacheStartedAt(entry)
        if (candidate !== null && (startedAt === null || candidate < startedAt)) {
          startedAt = candidate
        }
      }
      return startedAt
    }, [store, worktreeId, enabled, ttlMs]),
    enabled && ttlMs > 0
  )
  let startedAt = terminalStartedAt
  if (nativeStartedAt !== null && (startedAt === null || nativeStartedAt < startedAt)) {
    startedAt = nativeStartedAt
  }
  return enabled && ttlMs > 0 && startedAt != null ? startedAt : null
}

export function usePromptCacheCountdownForPane(
  paneKey: string,
  active = true
): PromptCacheCountdownSelection | null {
  const [enabled, ttlMs, structured, terminalStartedAt] = useAppStore(
    useShallow((s) => {
      if (!active || !(s.settings?.promptCacheTimerEnabled ?? false)) {
        return [false, 0, false, null] as const
      }
      const ttlMs = s.settings?.promptCacheTtlMs ?? 0
      return [
        true,
        ttlMs,
        getStructuredAgentSessionTabsByPaneKey(s.unifiedTabsByWorktree).has(paneKey),
        getPromptCacheCountdownForPane(paneKey, s.cacheTimerByKey, ttlMs)?.startedAt ?? null
      ] as const
    })
  )
  const nativeStartedAt = useAgentStatusSelector(
    enabled && ttlMs > 0 && structured ? paneKey : null,
    getStructuredPromptCacheStartedAt
  )
  const startedAt = structured ? nativeStartedAt : terminalStartedAt
  return useMemo(
    () => (enabled && ttlMs > 0 && startedAt !== null ? { startedAt, ttlMs } : null),
    [enabled, ttlMs, startedAt]
  )
}

/** Expose cache expiry so users can resume before uncached conversation input increases cost. */
export default function CacheTimer({
  startedAt,
  ttlMs
}: {
  startedAt: number
  ttlMs: number
}): React.JSX.Element {
  const t = useTranslate()
  const now = usePromptCacheCountdownNow(true)
  const remainingMs = Math.max(0, ttlMs - (now - startedAt))

  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const label = `${minutes}:${seconds.toString().padStart(2, '0')}`

  const expired = remainingMs === 0
  const warning = !expired && remainingMs <= 60_000

  const tooltipText = expired
    ? t(
        'auto.components.sidebar.CacheTimer.expiredTooltip',
        'The next message will re-send the full context as uncached tokens'
      )
    : t('auto.components.sidebar.CacheTimer.expiresIn', 'Prompt cache expires in {{time}}', {
        time: label
      })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'inline-flex items-center gap-1 text-[10px] font-mono tabular-nums select-none leading-none',
            expired ? 'text-red-400' : warning ? 'text-yellow-400' : 'text-muted-foreground'
          )}
        >
          <Timer className="size-2.5" />
          {!expired && <span>{label}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        <span>{tooltipText}</span>
      </TooltipContent>
    </Tooltip>
  )
}
