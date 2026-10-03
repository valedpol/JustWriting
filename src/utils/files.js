export async function bytesHash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

// Explicit download only. The caller revokes the returned URL after completion.
export function downloadFile(file, filename) {
  const url = URL.createObjectURL(file), link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  return { filename, url }
}
