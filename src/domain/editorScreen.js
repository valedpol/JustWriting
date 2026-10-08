export const SCREEN_MODES = {
  interface: 'interface',
  standard: 'writing-standard',
  wide: 'writing-wide',
}

const sections = ['today', 'archive', 'settings', 'research', 'feed']
const sectionStorageKey = 'just-writing-current-section-v1'

export const initialScreen = { section: 'today', screenMode: SCREEN_MODES.interface }

// A writing mode belongs to today's editor, never to the archive.
export function editorScreenReducer(state, action) {
  if (action.type === 'section') {
    if (!sections.includes(action.section)) return state
    return { section: action.section, screenMode: SCREEN_MODES.interface }
  }
  if (action.type === 'mode' && state.section === 'today' && Object.values(SCREEN_MODES).includes(action.mode)) {
    return { ...state, screenMode: action.mode }
  }
  return state
}

// Persist only the top-level page, per tab. Writing modes and page criteria reset.
export function restoreScreen(storage) {
  try {
    const section = (storage ?? globalThis.sessionStorage)?.getItem(sectionStorageKey)
    return sections.includes(section) ? { ...initialScreen, section } : initialScreen
  } catch { return initialScreen }
}

export function rememberSection(section, storage) {
  if (!sections.includes(section)) return
  try { (storage ?? globalThis.sessionStorage)?.setItem(sectionStorageKey, section) } catch { /* Navigation still works without browser storage. */ }
}
