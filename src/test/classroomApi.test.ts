import * as assert from 'assert';
import {
  assignmentRepoName,
  renderClassroomMetadata,
  validateOrgAccess,
  discoverClassroomsFromRepos,
  commitFiles,
  ensureFeedbackPullRequest,
  getRepoFeatureSettings,
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
  test('produces official repo-config YAML with schema, owner metadata, and source block', () => {
    const result = renderClassroomMetadata({
      classroom: 'cs50-fall',
      assignment: 'pset1',
      schema: 'classroom50/repo-config/v1',
      owner: { username: 'alice', id: 42, acceptedAt: '2026-07-28T10:30:00.000Z' },
      source: { owner: 'cs50', repo: 'pset1-template', branch: 'main' },
    });
    const expected = [
      'schema: "classroom50/repo-config/v1"',
      'classroom: "cs50-fall"',
      'assignment: "pset1"',
      'owner:',
      '  username: "alice"',
      '  id: 42',
      '  accepted_at: "2026-07-28T10:30:00.000Z"',
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
      schema: 'classroom50/repo-config/v1',
      owner: { username: 'alice', acceptedAt: '2026-07-28T10:30:00.000Z' },
      source: { owner: 'o', repo: 'r', branch: 'b' },
    });
    assert.ok(result.endsWith('\n'), 'Expected trailing newline');
  });

  test('wraps values containing special characters in double quotes', () => {
    const result = renderClassroomMetadata({
      classroom: 'fall: 2026',
      assignment: 'hw#1',
      schema: 'classroom50/repo-config/v1',
      owner: { username: 'alice', acceptedAt: '2026-07-28T10:30:00.000Z' },
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

// ---------------------------------------------------------------------------
// getRepoFeatureSettings
// ---------------------------------------------------------------------------

suite('getRepoFeatureSettings', () => {
  let savedFetch: typeof globalThis.fetch;

  setup(() => {
    savedFetch = globalThis.fetch;
  });

  teardown(() => {
    globalThis.fetch = savedFetch;
  });

  test('returns normalized feature booleans from repo payload', async () => {
    globalThis.fetch = async () =>
      ({
        status: 200,
        ok: true,
        json: async () => ({
          has_issues: true,
          has_wiki: false,
          has_projects: true,
          has_pull_requests: false,
        }),
        text: async () => '{}',
      }) as Response;

    const result = await getRepoFeatureSettings('token', 'cs50', 'template-repo');
    assert.deepStrictEqual(result, {
      has_issues: true,
      has_wiki: false,
      has_projects: true,
      has_pull_requests: false,
    });
  });

  test('returns undefined for 404 response', async () => {
    globalThis.fetch = async () =>
      ({
        status: 404,
        ok: false,
        json: async () => ({ message: 'Not Found' }),
        text: async () => JSON.stringify({ message: 'Not Found' }),
      }) as Response;

    const result = await getRepoFeatureSettings('token', 'cs50', 'missing-template');
    assert.strictEqual(result, undefined);
  });
});

// ---------------------------------------------------------------------------
// commitFiles
// ---------------------------------------------------------------------------

suite('commitFiles', () => {
  let savedFetch: typeof globalThis.fetch;

  setup(() => {
    savedFetch = globalThis.fetch;
  });

  teardown(() => {
    globalThis.fetch = savedFetch;
  });

  test('returns the created commit SHA', async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/branches/main')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({ commit: { sha: 'parent-sha', commit: { tree: { sha: 'base-tree-sha' } } } }),
          text: async () => '{}',
        } as Response;
      }
      if (url.endsWith('/git/blobs')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({ sha: 'blob-sha' }),
          text: async () => '{}',
        } as Response;
      }
      if (url.endsWith('/git/trees')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({ sha: 'new-tree-sha' }),
          text: async () => '{}',
        } as Response;
      }
      if (url.endsWith('/git/commits') && init?.method === 'POST') {
        return {
          status: 200,
          ok: true,
          json: async () => ({ sha: 'new-commit-sha' }),
          text: async () => '{}',
        } as Response;
      }
      if (url.endsWith('/git/refs/heads/main') && init?.method === 'PATCH') {
        return {
          status: 204,
          ok: true,
          json: async () => ({}),
          text: async () => '',
        } as Response;
      }
      throw new Error(`Unhandled request: ${url} ${init?.method || 'GET'}`);
    };

    const sha = await commitFiles('token', 'o', 'r', 'main', 'msg', {
      '.classroom50.yaml': 'content',
    });
    assert.strictEqual(sha, 'new-commit-sha');
  });
});

// ---------------------------------------------------------------------------
// ensureFeedbackPullRequest
// ---------------------------------------------------------------------------

suite('ensureFeedbackPullRequest', () => {
  let savedFetch: typeof globalThis.fetch;

  setup(() => {
    savedFetch = globalThis.fetch;
  });

  teardown(() => {
    globalThis.fetch = savedFetch;
  });

  type MockApiResponse = {
    status?: number;
    body?: unknown;
    message?: string;
  };

  function makeApiFetch(
    handlers: Array<(path: string, method: string, body: unknown) => MockApiResponse | undefined>
  ): typeof globalThis.fetch {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      const path = `${url.pathname}${url.search}`.replace(/^\//, '');
      const method = init?.method || 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

      for (const handler of handlers) {
        const res = handler(path, method, body);
        if (!res) {
          continue;
        }
        const status = res.status ?? 200;
        const ok = status >= 200 && status < 300;
        const payload = ok ? res.body ?? {} : { message: res.message ?? 'error' };
        return {
          status,
          ok,
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as Response;
      }

      throw new Error(`Unhandled request: ${method} ${path}`);
    };
  }

  test('short-circuits when PR already exists', async () => {
    globalThis.fetch = makeApiFetch([
      (path, method) => {
        if (method === 'GET' && path.includes('/pulls?')) {
          return { body: [{ number: 7 }] };
        }
        return undefined;
      },
    ]);

    const result = await ensureFeedbackPullRequest({
      token: 'token',
      owner: 'o',
      repo: 'r',
      branch: 'main',
      acceptCommitSha: 'accept-sha',
      mode: 'individual',
    });
    assert.deepStrictEqual(result, { ok: true, created: false });
  });

  test('creates empty commit and retries after no-commits-between 422', async () => {
    let prCreateAttempts = 0;
    let emptyCommitBody: Record<string, unknown> | undefined;

    globalThis.fetch = makeApiFetch([
      (path, method, body) => {
        if (method === 'GET' && path.includes('/pulls?')) {
          return { body: [] };
        }
        if (method === 'POST' && path.endsWith('/git/refs')) {
          return { body: {} };
        }
        if (method === 'POST' && path.endsWith('/pulls')) {
          prCreateAttempts += 1;
          if (prCreateAttempts === 1) {
            return { status: 422, message: 'No commits between feedback and main' };
          }
          return { body: { number: 1, html_url: 'https://github.com/o/r/pull/1' } };
        }
        if (method === 'GET' && path.endsWith('/git/ref/heads/main')) {
          return { body: { object: { sha: 'accept-sha' } } };
        }
        if (method === 'GET' && path.endsWith('/git/commits/accept-sha')) {
          return { body: { tree: { sha: 'tree-sha' } } };
        }
        if (method === 'POST' && path.endsWith('/git/commits')) {
          emptyCommitBody = body as Record<string, unknown>;
          return { body: { sha: 'empty-sha' } };
        }
        if (method === 'PATCH' && path.endsWith('/git/refs/heads/main')) {
          return { body: {} };
        }
        if (method === 'POST' && path.endsWith('/labels')) {
          return { body: {} };
        }
        if (method === 'POST' && path.endsWith('/issues/1/labels')) {
          return { body: {} };
        }
        return undefined;
      },
    ]);

    const result = await ensureFeedbackPullRequest({
      token: 'token',
      owner: 'o',
      repo: 'r',
      branch: 'main',
      acceptCommitSha: 'accept-sha',
      mode: 'individual',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(prCreateAttempts, 2);
    assert.deepStrictEqual(emptyCommitBody, {
      message: '[Classroom 50] Open Feedback PR (gh student accept)\n\n[skip ci]',
      tree: 'tree-sha',
      parents: ['accept-sha'],
    });
  });

  test('returns non-fatal failure when feedback base exists at wrong SHA', async () => {
    globalThis.fetch = makeApiFetch([
      (path, method) => {
        if (method === 'GET' && path.includes('/pulls?')) {
          return { body: [] };
        }
        if (method === 'POST' && path.endsWith('/git/refs')) {
          return { status: 422, message: 'Reference already exists' };
        }
        if (method === 'GET' && path.endsWith('/git/ref/heads/feedback')) {
          return { body: { object: { sha: 'student-sha' } } };
        }
        return undefined;
      },
    ]);

    const result = await ensureFeedbackPullRequest({
      token: 'token',
      owner: 'o',
      repo: 'r',
      branch: 'main',
      acceptCommitSha: 'accept-sha',
      mode: 'individual',
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reason.includes('not the expected baseline'));
    }
  });

  test('handles PR create race by re-querying existing PR', async () => {
    let listCount = 0;

    globalThis.fetch = makeApiFetch([
      (path, method) => {
        if (method === 'GET' && path.includes('/pulls?')) {
          listCount += 1;
          if (listCount === 1) {
            return { body: [] };
          }
          return { body: [{ number: 2 }] };
        }
        if (method === 'POST' && path.endsWith('/git/refs')) {
          return { body: {} };
        }
        if (method === 'POST' && path.endsWith('/pulls')) {
          return { status: 422, message: 'A pull request already exists' };
        }
        if (method === 'POST' && path.endsWith('/labels')) {
          return { body: {} };
        }
        if (method === 'POST' && path.endsWith('/issues/2/labels')) {
          return { body: {} };
        }
        return undefined;
      },
    ]);

    const result = await ensureFeedbackPullRequest({
      token: 'token',
      owner: 'o',
      repo: 'r',
      branch: 'main',
      acceptCommitSha: 'accept-sha',
      mode: 'group',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(listCount, 2);
  });
});
