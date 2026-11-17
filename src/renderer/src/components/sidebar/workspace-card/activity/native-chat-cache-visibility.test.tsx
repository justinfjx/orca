// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { acceptedAgentStatuses } from '@/store/slices/agent-status/accepted-agent-statuses'
import type { AgentSessionStatusEvent } from '../../../../../../shared/agent-session/agent-session-wire'
import { structuredAgentSessionPaneKey } from '../../../../../../shared/agent-session/view/structured-agent-session-projection'
import { getDefaultSettings } from '../../../../../../shared/constants'
import { TooltipProvider } from '@/components/ui/tooltip'

const boundary = vi.hoisted(() => ({ subscribeStatus: vi.fn() }))
vi.mock('@/store', async () => {
  const { createTestStore } = await import('@/store/testing/app-store-test-fixture')
  return { useAppStore: createTestStore() }
})
vi.mock('@/runtime/native-chat/requests/structured-agent-session-call', () => ({
  callStructuredAgentSession: vi.fn()
}))
vi.mock('@/runtime/native-chat/requests/structured-agent-session-subscriptions', () => ({
  subscribeStructuredAgentSession: vi.fn(),
  subscribeStructuredAgentSessionStatus: boundary.subscribeStatus
}))
vi.mock('@/runtime/rpc/compatibility/runtime-capability-proof', () => ({
  runtimeEnvironmentSupportsCapability: vi.fn(async () => true)
}))

import { useAppStore } from '@/store'
import { StructuredAgentSessionStatusBridge } from '@/components/native-chat/session/status/StructuredAgentSessionStatusBridge'
import CacheTimer, {
  usePromptCacheCountdownForPane,
  usePromptCacheCountdownStartedAt
} from './CacheTimer'

const paneKey = structuredAgentSessionPaneKey('chat-1', 'session-1')

function NativeCacheIndicators() {
  const pane = usePromptCacheCountdownForPane(paneKey)
  const workspace = usePromptCacheCountdownStartedAt('wt-1')
  return (
    <>
      <div data-testid="pane-cache">{pane && <CacheTimer {...pane} />}</div>
      <div data-testid="workspace-cache">
        {workspace !== null && <CacheTimer startedAt={workspace} ttlMs={300000} />}
      </div>
    </>
  )
}

afterEach(cleanup)

it('shows native Claude cache indicators for a settled turn and removes them while it works', async () => {
  useAppStore.setState({
    settings: { ...getDefaultSettings('/tmp'), promptCacheTimerEnabled: true },
    agentStatusByPaneKey: acceptedAgentStatuses(),
    unifiedTabsByWorktree: {
      'wt-1': [
        {
          id: 'chat-1',
          worktreeId: 'wt-1',
          groupId: 'group-1',
          contentType: 'agent-session',
          entityId: 'session-1',
          label: 'Claude',
          customLabel: null,
          color: null,
          sortOrder: 0,
          createdAt: 0,
          agentSessionAgent: 'claude'
        }
      ]
    },
    tabsByWorktree: {},
    cacheTimerByKey: {}
  })
  const connected = new Promise<(event: AgentSessionStatusEvent) => void>((resolve) => {
    boundary.subscribeStatus.mockImplementation(async (_params, callback) => {
      resolve(callback)
      return { unsubscribe: () => {} }
    })
  })
  render(
    <TooltipProvider>
      <StructuredAgentSessionStatusBridge />
      <NativeCacheIndicators />
    </TooltipProvider>
  )
  const emit = await connected
  expect(screen.getByTestId('pane-cache').textContent).toBe('')
  const settled = {
    sessionId: 'session-1',
    workspaceId: 'wt-1',
    agent: 'claude',
    status: 'idle' as const,
    latestPrompt: 'Explain the result',
    updatedAt: Date.now(),
    statusStartedAt: Date.now()
  }
  await act(async () => emit({ type: 'snapshot', sessions: [settled] }))
  expect(screen.getByTestId('pane-cache').textContent).not.toBe('')
  expect(screen.getByTestId('workspace-cache').textContent).not.toBe('')
  await act(async () => emit({ type: 'status', session: { ...settled, status: 'working' } }))
  expect(screen.getByTestId('pane-cache').textContent).toBe('')
  expect(screen.getByTestId('workspace-cache').textContent).toBe('')
})
