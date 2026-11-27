export function hasRequiredRole(member, requiredRole) {
  return Boolean(requiredRole && member.roles.highest.comparePositionTo(requiredRole) >= 0);
}
