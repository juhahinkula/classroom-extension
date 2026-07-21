import * as assert from 'assert';
import {
  assignmentRepoName,
  renderClassroomMetadata,
  validateOrgAccess,
  discoverClassroomsFromRepos,
} from '../api/classroomApi';
import { GitHubRepo } from '../types';

// ---------------------------------------------------------------------------
// assignmentRepoName
// ---------------------------------------------------------------------------

suite('assignmentRepoName', () => {
  test('concatenates classroom, assignment, and login with hyphens', () => {
    assert.strictEqual(
      assignmentRepoName('cs50-fall', 'pset1', 'alice'),
      'cs50-fall-pset1-alice'
    );
  });

  test('lowercases all parts', () => {
    assert.strictEqual(
      assignmentRepoName('CS50-Fall', 'PSET1', 'Alice'),
      'cs50-fall-pset1-alice'
    );
  });

  test('handles single-segment names', () => {
    assert.strictEqual(
      assignmentRepoName('classroom', 'hw', 'bob'),
      'classroom-hw-bob'
    );
  });
});

// ---------------------------------------------------------------------------
// renderClassroomMetadata
// ---------------------------------------------------------------------------

suite('renderClassroomMetadata', () => {
  test('produces double-quoted YAML with all required fields', () => {
    const result = renderClassroomMetadata({
      classroom: 'cs50-fall',
      assignment: 'pset1',
      source: { owner: 'cs50', repo: 'pset1-template', branch: 'main' },
    });
    const expected = [
      'classroom: "cs50-fall"',
      'assignment: "pset1"',
      'source:',
      '  owner: "cs50"',
      '  repo: "pset1-template"',
      '  branch: "main"',
      '',
    ].join('\n');
    assert.strictEqual(result, expected);
  });

  test('ends with a trailing newline', () => {
    const result = renderClassroomMetadata({
      classroom: 'c',
      assignment: 'a',
      source: { owner: 'o', repo: 'r', branch: 'b' },
    });
    assert.ok(result.endsWith('\n'), 'Expected trailing newline');
  });

  test('wraps values containing special characters in double quotes', () => {
    const result = renderClassroomMetadata({
      classroom: 'fall: 2026',
      assignment: 'hw#1',
      source: { owner: 'o', repo: 'r', branch: 'b' },
    });
    assert.ok(result.includes('"fall: 2026"'));
    assert.ok(result.includes('"hw#1"'));
  });
});

// ---------------------------------------------------------------------------
// validateOrgAccess
// ---------------------------------------------------------------------------

suite('validateOrgAccess', () => {
  const orgInfo = { login: 'cs50', id: 1, description: null };

  test('returns undefined when org exists and membership is active', () => {
    const error = validateOrgAccess('cs50', orgInfo, { state: 'active' });
    assert.strictEqual(error, undefined);
  });

  test('returns error message when orgInfo is null (org not found)', () => {
    const error = validateOrgAccess('missing-org', null, { state: 'active' });
    assert.ok(typeof error === 'string', 'Expected error string');
    assert.ok(error.includes('not found'), `Unexpected message: ${error}`);
  });

  test('returns error message when membership is null (not a member)', () => {
    const error = validateOrgAccess('cs50', orgInfo, null);
    assert.ok(typeof error === 'string', 'Expected error string');
    assert.ok(
      error.toLowerCase().includes('belong') || error.toLowerCase().includes('member'),
      `Unexpected message: ${error}`
    );
  });

  test('returns error message when membership state is pending', () => {
    const error = validateOrgAccess('cs50', orgInfo, { state: 'pending' });
    assert.ok(typeof error === 'string', 'Expected error string');
    assert.ok(error.toLowerCase().includes('pending'), `Unexpected message: ${error}`);
  });

  test('includes org name in error when org is not found', () => {
    const error = validateOrgAccess('no-such-org', null, null);
    assert.ok(error?.includes('no-such-org'), `Expected org name in error: ${error}`);
  });
});

// ---------------------------------------------------------------------------
// discoverClassroomsFromRepos
// ---------------------------------------------------------------------------

suite('discoverClassroomsFromRepos', () => {
  let savedFetch: typeof globalThis.fetch;

  setup(() => {
    savedFetch = globalThis.fetch;
  });

  teardown(() => {
    globalThis.fetch = savedFetch;
  });

  function makeRepo(name: string): GitHubRepo {
    return { name, full_name: `org/${name}`, html_url: '', private: true, owner: { login: 'org' } };
  }

  function mockRepos(repos: GitHubRepo[]): void {
    globalThis.fetch = async () =>
      ({
        status: 200,
        ok: true,
        json: async () => repos,
        text: async () => JSON.stringify(repos),
      }) as Response;
  }

  test('extracts classroom slug from repo names matching the login suffix', async () => {
    mockRepos([
      makeRepo('cs50-fall-pset1-alice'),
      makeRepo('cs50-fall-pset2-alice'),
    ]);
    const result = await discoverClassroomsFromRepos('token', 'org', 'alice');
    assert.deepStrictEqual(result, ['cs50-fall']);
  });

  test('returns multiple distinct classrooms', async () => {
    mockRepos([
      makeRepo('cs50-fall-pset1-alice'),
      makeRepo('cs50-spring-hw1-alice'),
    ]);
    const result = await discoverClassroomsFromRepos('token', 'org', 'alice');
    assert.ok(result.includes('cs50-fall'), 'Expected cs50-fall');
    assert.ok(result.includes('cs50-spring'), 'Expected cs50-spring');
    assert.strictEqual(result.length, 2);
  });

  test('deduplicates classroom names', async () => {
    mockRepos([
      makeRepo('cs50-fall-pset1-alice'),
      makeRepo('cs50-fall-pset2-alice'),
      makeRepo('cs50-fall-pset3-alice'),
    ]);
    const result = await discoverClassroomsFromRepos('token', 'org', 'alice');
    assert.deepStrictEqual(result, ['cs50-fall']);
  });

  test('ignores repos that do not end with the login suffix', async () => {
    mockRepos([
      makeRepo('cs50-fall-pset1-bob'),
      makeRepo('cs50-fall-pset1-alice'),
    ]);
    const result = await discoverClassroomsFromRepos('token', 'org', 'alice');
    assert.deepStrictEqual(result, ['cs50-fall']);
  });

  test('is case-insensitive for login suffix matching', async () => {
    mockRepos([makeRepo('cs50-fall-pset1-Alice')]);
    const result = await discoverClassroomsFromRepos('token', 'org', 'Alice');
    assert.deepStrictEqual(result, ['cs50-fall']);
  });

  test('returns empty array when no matching repos found', async () => {
    mockRepos([makeRepo('some-other-repo')]);
    const result = await discoverClassroomsFromRepos('token', 'org', 'alice');
    assert.deepStrictEqual(result, []);
  });

  test('returns empty array on fetch error', async () => {
    globalThis.fetch = async () => {
      throw new Error('Network error');
    };
    const result = await discoverClassroomsFromRepos('token', 'org', 'alice');
    assert.deepStrictEqual(result, []);
  });
});
