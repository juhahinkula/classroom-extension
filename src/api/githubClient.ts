const GITHUB_API_BASE = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export async function ghFetch<T>(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${GITHUB_API_BASE}/${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const text = await response.text();
    let message = `GitHub API error ${response.status}`;
    try {
      const json = JSON.parse(text) as { message?: string };
      if (json.message) {
        message = json.message;
      }
    } catch {
      /* ignore */
    }
    throw new GitHubError(response.status, message);
  }

  return response.json() as Promise<T>;
}
