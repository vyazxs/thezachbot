import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRequiredRole } from './permissions.js';

test('allows the required role and roles above it', () => {
  const requiredRole = { position: 5 };
  const member = (position) => ({
    roles: { highest: { comparePositionTo: (role) => position - role.position } }
  });

  assert.equal(hasRequiredRole(member(5), requiredRole), true);
  assert.equal(hasRequiredRole(member(8), requiredRole), true);
  assert.equal(hasRequiredRole(member(4), requiredRole), false);
});

test('denies access when the required role is not configured', () => {
  const member = { roles: { highest: { comparePositionTo: () => 1 } } };
  assert.equal(hasRequiredRole(member, null), false);
});
