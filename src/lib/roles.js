// 'admin' and 'superadmin' both get management access — most of the UI just
// needs to know "can this person manage family settings," not which tier.
export function isAdmin(role) {
  return role === 'admin' || role === 'superadmin'
}

export function isSuperadmin(role) {
  return role === 'superadmin'
}
