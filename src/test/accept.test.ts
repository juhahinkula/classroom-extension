import * as assert from 'assert';
import { resolveFounderPermission, resolveRepoFeaturePatches } from '../commands/accept';

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

suite('resolveRepoFeaturePatches', () => {
  test('uses template values for inherited issues/wiki/projects', () => {
    const result = resolveRepoFeaturePatches(
      undefined,
      {
        has_issues: true,
        has_wiki: false,
        has_projects: true,
      }
    );
    assert.deepStrictEqual(result.full, {
      has_issues: true,
      has_wiki: false,
      has_projects: true,
    });
    assert.deepStrictEqual(result.explicit, {});
  });

  test('omits inherited keys when no template values are available', () => {
    const result = resolveRepoFeaturePatches(undefined, undefined);
    assert.deepStrictEqual(result.full, {});
    assert.deepStrictEqual(result.explicit, {});
  });

  test('explicit assignment values override template values', () => {
    const result = resolveRepoFeaturePatches(
      {
        issues: false,
        wiki: true,
      },
      {
        has_issues: true,
        has_wiki: false,
        has_projects: true,
      }
    );

    assert.deepStrictEqual(result.full, {
      has_issues: false,
      has_wiki: true,
      has_projects: true,
    });
    assert.deepStrictEqual(result.explicit, {
      has_issues: false,
      has_wiki: true,
    });
  });

  test('includes pull-requests only when explicit', () => {
    const inherited = resolveRepoFeaturePatches(undefined, {
      has_issues: true,
    });
    assert.strictEqual(inherited.full.has_pull_requests, undefined);

    const explicit = resolveRepoFeaturePatches({ pull_requests: false }, undefined);
    assert.deepStrictEqual(explicit.full, { has_pull_requests: false });
    assert.deepStrictEqual(explicit.explicit, { has_pull_requests: false });
  });
});
