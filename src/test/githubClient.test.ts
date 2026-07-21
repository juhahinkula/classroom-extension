import * as assert from 'assert';
import { ghFetch, GitHubError } from '../api/githubClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CapturedRequest = {
  url: string;
  init?: RequestInit;
};

function makeMockFetch(
  captured: CapturedRequest,
  response: Partial<Response> & { bodyText?: string }
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.url = input.toString();
    captured.init = init;
    const bodyText = response.bodyText ?? '{}';
    return {
      status: response.status ?? 200,
      ok: response.ok ?? ((response.status ?? 200) >= 200 && (response.status ?? 200) < 300),
      json: async () => JSON.parse(bodyText),
      text: async () => bodyText,
    } as Response;
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
// URL construction
// ---------------------------------------------------------------------------

suite('ghFetch URL construction', () => {
  test('prepends GitHub API base URL for relative paths', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, { bodyText: '{}' });
    await ghFetch<unknown>('token', 'user');
    assert.strictEqual(captured.url, 'https://api.github.com/user');
  });

  test('uses path as-is when it starts with "http"', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, { bodyText: '{}' });
    await ghFetch<unknown>('token', 'https://example.com/resource');
    assert.strictEqual(captured.url, 'https://example.com/resource');
  });
});

// ---------------------------------------------------------------------------
// Request headers
// ---------------------------------------------------------------------------

suite('ghFetch request headers', () => {
  test('includes Authorization header with token', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, { bodyText: '{}' });
    await ghFetch<unknown>('my-secret-token', 'user');
    const headers = captured.init?.headers as Record<string, string> | undefined;
    assert.ok(headers, 'Expected headers to be set');
    const authHeader = headers['Authorization'] ?? headers['authorization'];
    assert.ok(
      typeof authHeader === 'string' && authHeader.includes('my-secret-token'),
      `Expected token in Authorization header, got: ${authHeader}`
    );
  });

  test('includes GitHub API Accept header', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, { bodyText: '{}' });
    await ghFetch<unknown>('token', 'user');
    const headers = captured.init?.headers as Record<string, string> | undefined;
    const acceptHeader = headers?.['Accept'] ?? headers?.['accept'];
    assert.ok(
      typeof acceptHeader === 'string' && acceptHeader.includes('application/vnd.github'),
      `Expected GitHub Accept header, got: ${acceptHeader}`
    );
  });

  test('adds Content-Type header when body is provided', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, { bodyText: '{}' });
    await ghFetch<unknown>('token', 'repos', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    });
    const headers = captured.init?.headers as Record<string, string> | undefined;
    const contentType = headers?.['Content-Type'] ?? headers?.['content-type'];
    assert.strictEqual(contentType, 'application/json');
  });

  test('does not add Content-Type header when body is absent', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, { bodyText: '{}' });
    await ghFetch<unknown>('token', 'user');
    const headers = captured.init?.headers as Record<string, string> | undefined;
    const contentType = headers?.['Content-Type'] ?? headers?.['content-type'];
    assert.strictEqual(contentType, undefined);
  });
});

// ---------------------------------------------------------------------------
// 204 No Content
// ---------------------------------------------------------------------------

suite('ghFetch 204 handling', () => {
  test('returns undefined for 204 No Content responses', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, { status: 204, ok: true, bodyText: '' });
    const result = await ghFetch<string | undefined>('token', 'endpoint');
    assert.strictEqual(result, undefined);
  });
});

// ---------------------------------------------------------------------------
// Successful JSON response
// ---------------------------------------------------------------------------

suite('ghFetch successful response', () => {
  test('returns parsed JSON body on 200 OK', async () => {
    const captured: CapturedRequest = { url: '' };
    const payload = { login: 'alice', id: 42 };
    globalThis.fetch = makeMockFetch(captured, {
      status: 200,
      ok: true,
      bodyText: JSON.stringify(payload),
    });
    const result = await ghFetch<{ login: string; id: number }>('token', 'user');
    assert.deepStrictEqual(result, payload);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

suite('ghFetch error handling', () => {
  test('throws GitHubError on non-OK response', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, {
      status: 404,
      ok: false,
      bodyText: JSON.stringify({ message: 'Not Found' }),
    });
    await assert.rejects(
      () => ghFetch<unknown>('token', 'missing'),
      (err: unknown) => err instanceof GitHubError
    );
  });

  test('GitHubError carries the HTTP status code', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, {
      status: 403,
      ok: false,
      bodyText: JSON.stringify({ message: 'Forbidden' }),
    });
    try {
      await ghFetch<unknown>('token', 'protected');
      assert.fail('Expected GitHubError to be thrown');
    } catch (err) {
      assert.ok(err instanceof GitHubError);
      assert.strictEqual(err.status, 403);
    }
  });

  test('uses JSON "message" field as error message when available', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, {
      status: 422,
      ok: false,
      bodyText: JSON.stringify({ message: 'Unprocessable Entity – name already taken' }),
    });
    try {
      await ghFetch<unknown>('token', 'repos');
      assert.fail('Expected GitHubError to be thrown');
    } catch (err) {
      assert.ok(err instanceof GitHubError);
      assert.ok(
        err.message.includes('Unprocessable Entity'),
        `Unexpected message: ${err.message}`
      );
    }
  });

  test('falls back to generic message when response body is not JSON', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, {
      status: 500,
      ok: false,
      bodyText: 'Internal Server Error',
    });
    try {
      await ghFetch<unknown>('token', 'endpoint');
      assert.fail('Expected GitHubError to be thrown');
    } catch (err) {
      assert.ok(err instanceof GitHubError);
      assert.ok(
        err.message.includes('500'),
        `Expected status in fallback message, got: ${err.message}`
      );
    }
  });

  test('GitHubError name is "GitHubError"', async () => {
    const captured: CapturedRequest = { url: '' };
    globalThis.fetch = makeMockFetch(captured, {
      status: 401,
      ok: false,
      bodyText: JSON.stringify({ message: 'Unauthorized' }),
    });
    try {
      await ghFetch<unknown>('token', 'user');
      assert.fail('Expected error');
    } catch (err) {
      assert.ok(err instanceof GitHubError);
      assert.strictEqual(err.name, 'GitHubError');
    }
  });
});
