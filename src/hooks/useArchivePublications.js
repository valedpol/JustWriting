import { useCallback, useEffect, useRef, useState } from 'react'
import { createPublications, listOwnPublications } from '../storage/publicationRepository.js'
import { PUBLICATION_CHANNELS } from '../publications/model.js'

// Only derived state. No publication flags or semantic metadata are saved to source.
export function useArchivePublications(controller, enabled) {
  return useSourcePublications(controller?.snapshot.record, enabled)
}

export function useSourcePublications(record, enabled = true) {
  const userId = record?.userId, sourceId = record?.textId
  const [state, setState] = useState({ records: [], loading: true, error: null })
  const generation = useRef({ value: 0 })
  const reload = useCallback(async () => {
    const guard = generation.current
    const ticket = ++guard.value
    setState(previous => ({ ...previous, loading: true, error: null }))
    try {
      const groups = await Promise.all(PUBLICATION_CHANNELS.map(channel => listOwnPublications(userId, channel)))
      const records = groups.flat().filter(item => item.source.sourceType === 'archive' && item.source.sourceId === sourceId)
      if (ticket === guard.value) setState({ records, loading: false, error: null })
      return records
    } catch (error) {
      if (ticket === guard.value) setState(previous => ({ ...previous, loading: false, error }))
      throw error
    }
  }, [userId, sourceId])
  useEffect(() => {
    const guard = generation.current
    let live = true
    if (enabled && userId && sourceId) Promise.resolve().then(() => {
      if (live) reload().catch(() => {})
    })
    return () => { live = false; guard.value++ }
  }, [enabled, userId, sourceId, reload])
  const create = useCallback(async (source, channels) => {
    const records = await createPublications(userId, { source, channels })
    // The committed result supplies immediate feedback even if refreshing fails.
    setState(previous => ({ ...previous, records: [...previous.records, ...records] }))
    await reload().catch(() => {})
    return records
  }, [userId, reload])
  return { ...state, reload, create }
}
