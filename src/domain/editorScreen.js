export const SCREEN_MODES = {
  interface: 'interface',
  standard: 'writing-standard',
  wide: 'writing-wide',
}

export const initialScreen = { section: 'today', screenMode: SCREEN_MODES.interface }

// A writing mode belongs to today's editor, never to the archive.
export function editorScreenReducer(state, action) {
  if (action.type === 'section') {
    if (!['today', 'archive', 'settings', 'research'].includes(action.section)) return state
    return { section: action.section, screenMode: SCREEN_MODES.interface }
  }
  if (action.type === 'mode' && state.section === 'today' && Object.values(SCREEN_MODES).includes(action.mode)) {
    return { ...state, screenMode: action.mode }
  }
  return state
}
