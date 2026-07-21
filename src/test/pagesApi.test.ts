import * as assert from 'assert';
import {
  isValidAccessKey,
  pagesAssignmentsUrl,
  pagesAutograderUrl,
  classroomsIndexUrl,
  orgPublishesClassroomPages,
  fetchClassroomsFromPages,
  fetchAssignments,
  resolveAutogradeWorkflow,
  AUTOGRADE_SHIM_URL,
  SHIM_ORG_PLACEHOLDER,
  SHIM_BRANCH_PLACEHOLDER,
  SHIM_CONFIG_BRANCH_PLACEHOLDER,
} from '../api/pagesApi';
import { ASSIGNMENTS_SCHEMA_V1 } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockResponseOptions = {
  status?: number;
  ok?: boolean;
  json?: unknown;
  text?: string;
};

function makeFetch(opts: MockResponseOptions): typeof globalThis.fetch {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  return async () =>
    ({
      status,
      ok,
      json: async () => opts.json ?? {},
      text: async () => opts.text ?? JSON.stringify(opts.json ?? {}),
    }) as Response;
}

function capturingFetch(
  captured: { url: string },
  opts: MockResponseOptions = {}
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL) => {
    captured.url = input.toString();
    return makeFetch(opts)(input);
  };
}

let savedFetch: typeof globalThis.fetch;

setup(() => {
  savedFetch = globalThis.fetch;
});

teardown(() => {
  globalThis.fetch = savedFetch;
});

// ---------------------------------------------------------------------------
// isValidAccessKey
// ---------------------------------------------------------------------------

suite('isValidAccessKey', () => {
  test('accepts 4-character lowercase alphanumeric key', () => {
    assert.ok(isValidAccessKey('ab12'));
  });

  test('accepts 64-character lowercase alphanumeric key', () => {
    assert.ok(isValidAccessKey('a'.repeat(32) + '1'.repeat(32)));
  });

  test('accepts mixed digits and lowercase letters', () => {
    assert.ok(isValidAccessKey('abc123xy'));
  });

  test('rejects empty string', () => {
    assert.strictEqual(isValidAccessKey(''), false);
  });

  test('rejects key shorter than 4 characters', () => {
    assert.strictEqual(isValidAccessKey('ab1'), false);
  });

  test('rejects key longer than 64 characters', () => {
    assert.strictEqual(isValidAccessKey('a'.repeat(65)), false);
  });

  test('rejects uppercase letters', () => {
    assert.strictEqual(isValidAccessKey('ABC123'), false);
  });

  test('rejects special characters', () => {
    assert.strictEqual(isValidAccessKey('abc-12'), false);
    assert.strictEqual(isValidAccessKey('abc_12'), false);
    assert.strictEqual(isValidAccessKey('abc 12'), false);
  });
});

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

suite('classroomsIndexUrl', () => {
  test('returns correct URL for an org', () => {
    assert.strictEqual(
      classroomsIndexUrl('cs50'),
      'https://cs50.github.io/classroom50/classrooms-index.json'
    );
  });
});

suite('pagesAssignmentsUrl', () => {
  test('returns correct URL without access key', () => {
    assert.strictEqual(
      pagesAssignmentsUrl('cs50', 'fall-2026'),
      'https://cs50.github.io/classroom50/fall-2026/assignments.json'
    );
  });

  test('appends encoded access key when provided', () => {
    const url = pagesAssignmentsUrl('cs50', 'fall-2026', 'abc123xy');
    assert.strictEqual(
      url,
      'https://cs50.github.io/classroom50/fall-2026/abc123xy/assignments.json'
    );
  });

  test('URL-encodes access key special characters', () => {
    const url = pagesAssignmentsUrl('cs50', 'fall-2026', 'key/val');
    assert.ok(url.includes('key%2Fval'), `Expected encoded slash, got: ${url}`);
  });
});

suite('pagesAutograderUrl', () => {
  test('returns correct URL without access key', () => {
    assert.strictEqual(
      pagesAutograderUrl('cs50', 'fall-2026', 'python-lint'),
      'https://cs50.github.io/classroom50/fall-2026/autograders/python-lint.yaml'
    );
  });

  test('appends encoded access key when provided', () => {
    const url = pagesAutograderUrl('cs50', 'fall-2026', 'python-lint', 'mykey123');
    assert.strictEqual(
      url,
      'https://cs50.github.io/classroom50/fall-2026/mykey123/autograders/python-lint.yaml'
    );
  });

  test('URL-encodes autograder name with special characters', () => {
    const url = pagesAutograderUrl('cs50', 'fall-2026', 'grader name');
    assert.ok(url.includes('grader%20name'), `Expected URL-encoded name, got: ${url}`);
  });
});

// ---------------------------------------------------------------------------
// orgPublishesClassroomPages
// ---------------------------------------------------------------------------

suite('orgPublishesClassroomPages', () => {
  test('returns "yes" when classrooms-index.json has a classrooms array', async () => {
    globalThis.fetch = makeFetch({
      status: 200,
      json: { classrooms: [{ short_name: 'cs50-fall', active: true }] },
    });
    const verdict = await orgPublishesClassroomPages('cs50');
    assert.strictEqual(verdict, 'yes');
  });

  test('returns "no" when classrooms-index.json is a 404', async () => {
    globalThis.fetch = makeFetch({ status: 404, ok: false, json: {} });
    const verdict = await orgPublishesClassroomPages('cs50');
    assert.strictEqual(verdict, 'no');
  });

  test('returns "no" when response JSON lacks a classrooms array', async () => {
    globalThis.fetch = makeFetch({ status: 200, json: { other: 'data' } });
    const verdict = await orgPublishesClassroomPages('cs50');
    assert.strictEqual(verdict, 'no');
  });

  test('returns "indeterminate" on non-OK, non-404 response', async () => {
    globalThis.fetch = makeFetch({ status: 500, ok: false, json: {} });
    const verdict = await orgPublishesClassroomPages('cs50');
    assert.strictEqual(verdict, 'indeterminate');
  });

  test('returns "indeterminate" when fetch throws (network error)', async () => {
    globalThis.fetch = async () => {
      throw new Error('Network failure');
    };
    const verdict = await orgPublishesClassroomPages('cs50');
    assert.strictEqual(verdict, 'indeterminate');
  });
});

// ---------------------------------------------------------------------------
// fetchClassroomsFromPages
// ---------------------------------------------------------------------------

suite('fetchClassroomsFromPages', () => {
  test('returns active classroom short names', async () => {
    globalThis.fetch = makeFetch({
      status: 200,
      json: {
        classrooms: [
          { short_name: 'cs50-fall', active: true },
          { short_name: 'cs50-spring', active: true },
        ],
      },
    });
    const result = await fetchClassroomsFromPages('cs50');
    assert.deepStrictEqual(result, ['cs50-fall', 'cs50-spring']);
  });

  test('filters out classrooms with active=false', async () => {
    globalThis.fetch = makeFetch({
      status: 200,
      json: {
        classrooms: [
          { short_name: 'active-class', active: true },
          { short_name: 'inactive-class', active: false },
        ],
      },
    });
    const result = await fetchClassroomsFromPages('cs50');
    assert.deepStrictEqual(result, ['active-class']);
  });

  test('includes classrooms when active field is absent (defaults to active)', async () => {
    globalThis.fetch = makeFetch({
      status: 200,
      json: { classrooms: [{ short_name: 'my-class' }] },
    });
    const result = await fetchClassroomsFromPages('cs50');
    assert.deepStrictEqual(result, ['my-class']);
  });

  test('returns empty array on non-OK response', async () => {
    globalThis.fetch = makeFetch({ status: 404, ok: false, json: {} });
    const result = await fetchClassroomsFromPages('cs50');
    assert.deepStrictEqual(result, []);
  });

  test('returns empty array on network error', async () => {
    globalThis.fetch = async () => {
      throw new Error('timeout');
    };
    const result = await fetchClassroomsFromPages('cs50');
    assert.deepStrictEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// fetchAssignments
// ---------------------------------------------------------------------------

suite('fetchAssignments', () => {
  const validAssignmentFile = {
    schema: ASSIGNMENTS_SCHEMA_V1,
    assignments: [
      {
        slug: 'pset1',
        name: 'Problem Set 1',
        mode: 'individual',
        template: { owner: 'cs50', repo: 'pset1-template', branch: 'main' },
        autograder: 'default',
      },
    ],
  };

  test('returns assignments from a valid response', async () => {
    globalThis.fetch = makeFetch({ status: 200, json: validAssignmentFile });
    const result = await fetchAssignments('cs50', 'fall-2026');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].slug, 'pset1');
  });

  test('returns empty array when assignments field is absent', async () => {
    globalThis.fetch = makeFetch({
      status: 200,
      json: { schema: ASSIGNMENTS_SCHEMA_V1 },
    });
    const result = await fetchAssignments('cs50', 'fall-2026');
    assert.deepStrictEqual(result, []);
  });

  test('includes access key in URL when provided', async () => {
    const captured = { url: '' };
    globalThis.fetch = capturingFetch(captured, { status: 200, json: validAssignmentFile });
    await fetchAssignments('cs50', 'fall-2026', 'mykey12');
    assert.ok(
      captured.url.includes('/mykey12/'),
      `Expected access key in URL, got: ${captured.url}`
    );
  });

  test('throws on 404 with helpful message', async () => {
    globalThis.fetch = makeFetch({ status: 404, ok: false });
    await assert.rejects(
      () => fetchAssignments('cs50', 'fall-2026'),
      /returned 404/
    );
  });

  test('throws on non-OK status', async () => {
    globalThis.fetch = makeFetch({ status: 500, ok: false, text: 'Server error' });
    await assert.rejects(
      () => fetchAssignments('cs50', 'fall-2026'),
      /unexpected status 500/
    );
  });

  test('throws on wrong schema version', async () => {
    globalThis.fetch = makeFetch({
      status: 200,
      json: { schema: 'classroom50/assignments/v2', assignments: [] },
    });
    await assert.rejects(
      () => fetchAssignments('cs50', 'fall-2026'),
      /schema/
    );
  });

  test('throws with URL in message on network error', async () => {
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch');
    };
    await assert.rejects(
      () => fetchAssignments('cs50', 'fall-2026'),
      /Could not reach/
    );
  });
});

// ---------------------------------------------------------------------------
// resolveAutogradeWorkflow
// ---------------------------------------------------------------------------

suite('resolveAutogradeWorkflow', () => {
  const validShimContent = `org: ${SHIM_ORG_PLACEHOLDER}\nbranch: ${SHIM_BRANCH_PLACEHOLDER}\nconfigBranch: ${SHIM_CONFIG_BRANCH_PLACEHOLDER}\njobs:\n  autograde:\n    runs-on: ubuntu-latest`;
  const validAutograderContent = `name: custom\njobs:\n  grade:\n    runs-on: ubuntu-latest`;

  test('fetches shim when autograderName is undefined', async () => {
    const captured = { url: '' };
    globalThis.fetch = capturingFetch(captured, { status: 200, text: validShimContent });
    await resolveAutogradeWorkflow('myorg', 'myclassroom', undefined);
    assert.strictEqual(captured.url, AUTOGRADE_SHIM_URL);
  });

  test('fetches shim when autograderName is "default"', async () => {
    const captured = { url: '' };
    globalThis.fetch = capturingFetch(captured, { status: 200, text: validShimContent });
    await resolveAutogradeWorkflow('myorg', 'myclassroom', 'default');
    assert.strictEqual(captured.url, AUTOGRADE_SHIM_URL);
  });

  test('fetches shim when autograderName is whitespace', async () => {
    const captured = { url: '' };
    globalThis.fetch = capturingFetch(captured, { status: 200, text: validShimContent });
    await resolveAutogradeWorkflow('myorg', 'myclassroom', '   ');
    assert.strictEqual(captured.url, AUTOGRADE_SHIM_URL);
  });

  test('replaces org placeholder in shim content', async () => {
    globalThis.fetch = makeFetch({ status: 200, text: validShimContent });
    const result = await resolveAutogradeWorkflow('myorg', 'myclassroom', undefined, undefined, 'main', 'main');
    assert.ok(result.includes('org: myorg'), `Expected org placeholder replaced, got:\n${result}`);
    assert.ok(!result.includes(SHIM_ORG_PLACEHOLDER));
  });

  test('replaces branch placeholder in shim content', async () => {
    globalThis.fetch = makeFetch({ status: 200, text: validShimContent });
    const result = await resolveAutogradeWorkflow('myorg', 'myclassroom', undefined, undefined, 'feature', 'config-main');
    assert.ok(result.includes('branch: feature'));
    assert.ok(result.includes('configBranch: config-main'));
  });

  test('fetches named autograder from Pages when name is given', async () => {
    const captured = { url: '' };
    globalThis.fetch = capturingFetch(captured, { status: 200, text: validAutograderContent });
    await resolveAutogradeWorkflow('myorg', 'myclassroom', 'python-lint');
    assert.ok(
      captured.url.includes('autograders/python-lint.yaml'),
      `Expected autograder URL, got: ${captured.url}`
    );
    assert.ok(captured.url.includes('myorg.github.io'));
  });

  test('throws when named autograder is 404', async () => {
    globalThis.fetch = makeFetch({ status: 404, ok: false });
    await assert.rejects(
      () => resolveAutogradeWorkflow('myorg', 'myclassroom', 'missing-grader'),
      /not published yet/
    );
  });

  test('throws when named autograder content is empty', async () => {
    globalThis.fetch = makeFetch({ status: 200, text: '   ' });
    await assert.rejects(
      () => resolveAutogradeWorkflow('myorg', 'myclassroom', 'empty-grader'),
      /empty/
    );
  });

  test('throws when named autograder content lacks "jobs:" key', async () => {
    globalThis.fetch = makeFetch({ status: 200, text: 'name: bad-yaml\nsteps: []' });
    await assert.rejects(
      () => resolveAutogradeWorkflow('myorg', 'myclassroom', 'malformed-grader'),
      /malformed YAML/
    );
  });
});
