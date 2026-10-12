import { useCallback, useEffect, useRef, useState } from 'react'
import { createPublications, listArchivePublications, deletePublication } from '../storage/publicationRepository.js'
import { reattachPublicationAnchor } from '../storage/publicationAnchorRepository.js'
import { initialPublicationAnchor } from '../publications/liveAnchors.js'

// Only derived state. No publication flags or semantic metadata are saved to source.
export function useArchivePublications(controller, enabled) {
  return useSourcePublications(controller?.snapshot.record, enabled)
}

export function useSourcePublications(record, enabled = true) {
  const userId = record?.userId, sourceId = record?.textId, revision = record?.revision
  const [state, setState] = useState({ records: [], loading: true, error: null })
  const generation = useRef({ value: 0 })
  const reload = useCallback(async () => {
    const guard = generation.current
    const ticket = ++guard.value
    setState(previous => ({ ...previous, loading: true, error: null }))
    try {
      const records = await listArchivePublications(userId, sourceId)
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
  }, [enabled, userId, sourceId, revision, reload])
  const create = useCallback(async (source, channels) => {
    const records = await createPublications(userId, { source, channels })
    // The committed result supplies immediate feedback even if refreshing fails.
    setState(previous => ({ ...previous, records: [...previous.records, ...records.map(record => ({ ...record, liveAnchor: initialPublicationAnchor(record) }))] }))
    await reload().catch(() => {})
    return records
  }, [userId, reload])
  const reattach = useCallback(async (publicationId, source) => {
    const anchor = await reattachPublicationAnchor(userId, publicationId, source)
    setState(previous => ({ ...previous, records: previous.records.map(record => record.publicationId === publicationId
      ? { ...record, liveAnchor: anchor } : record) }))
    await reload().catch(() => {})
    return anchor
  }, [userId, reload])
  const remove = useCallback(async publicationId => {
    await deletePublication(userId, publicationId)
    setState(previous => ({ ...previous, records: previous.records.filter(record => record.publicationId !== publicationId) }))
    await reload().catch(() => {})
  }, [userId, reload])
  return { ...state, reload, create, reattach, remove }
}
