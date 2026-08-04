import * as assert from 'assert';
import { resolveFounderPermission } from '../commands/accept';

suite('resolveFounderPermission', () => {
  test('uses push for individual mode by default', () => {
    assert.strictEqual(resolveFounderPermission('individual'), 'push');
  });

  test('uses admin for group mode by default', () => {
    assert.strictEqual(resolveFounderPermission('group'), 'admin');
  });

  test('defaults unknown or empty mode to individual push', () => {
    assert.strictEqual(resolveFounderPermission(''), 'push');
    assert.strictEqual(resolveFounderPermission('team'), 'push');
  });

  test('honors configured permission for individual assignments', () => {
    assert.strictEqual(resolveFounderPermission('individual', 'pull'), 'pull');
    assert.strictEqual(resolveFounderPermission('individual', 'triage'), 'triage');
    assert.strictEqual(resolveFounderPermission('individual', 'push'), 'push');
    assert.strictEqual(resolveFounderPermission('individual', 'maintain'), 'maintain');
    assert.strictEqual(resolveFounderPermission('individual', 'admin'), 'admin');
  });

  test('clamps group permissions below admin up to admin', () => {
    assert.strictEqual(resolveFounderPermission('group', 'pull'), 'admin');
    assert.strictEqual(resolveFounderPermission('group', 'triage'), 'admin');
    assert.strictEqual(resolveFounderPermission('group', 'push'), 'admin');
    assert.strictEqual(resolveFounderPermission('group', 'maintain'), 'admin');
  });

  test('preserves group admin permission', () => {
    assert.strictEqual(resolveFounderPermission('group', 'admin'), 'admin');
  });
});
