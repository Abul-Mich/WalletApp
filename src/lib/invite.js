// Invite links look like https://your-app/?invite=CODE. We keep the code until the person has joined a family.
const KEY = 'fw:invite'

function capture() {
  try {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('invite')
    if (code) {
      localStorage.setItem(KEY, code.trim())
      url.searchParams.delete('invite')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
  } catch { /* ignore */ }
}
capture()

export function getInvite() {
  try { return localStorage.getItem(KEY) || '' } catch { return '' }
}
export function clearInvite() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
