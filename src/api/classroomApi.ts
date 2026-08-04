import { ghFetch, GitHubError } from './githubClient';
import { GitHubUser, GitHubOrg, GitHubRepo, ClassroomConfig } from '../types';

export async function getUser(token: string): Promise<GitHubUser> {
  return ghFetch<GitHubUser>(token, 'user');
}

// Not used. There is no way to find which orgs are classroom orgs
// There is private classroom50 repo but student is not able to fetch it
export async function listUserOrgs(token: string): Promise<GitHubOrg[]> {
  return ghFetch<GitHubOrg[]>(token, 'user/orgs?per_page=100');
}

export async function listUserMemberOrgs(token: string): Promise<GitHubOrg[]> {
  return ghFetch<GitHubOrg[]>(token, 'user/orgs?role=member&per_page=100');
}

export async function getOrg(token: string, org: string): Promise<GitHubOrg | null> {
  try {
    return await ghFetch<GitHubOrg>(token, `orgs/${encodeURIComponent(org)}`);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function listUserReposInOrg(
  token: string,
  org: string
): Promise<GitHubRepo[]> {
  return ghFetch<GitHubRepo[]>(
    token,
    `orgs/${encodeURIComponent(org)}/repos?type=member&per_page=100`
  );
}

type RepoContentItem = {
  name: string;
  type: string;
};

export async function listClassroomsFromConfigRepo(
  token: string,
  org: string
): Promise<string[]> {
  try {
    const items = await ghFetch<RepoContentItem[]>(
      token,
      `repos/${encodeURIComponent(org)}/classroom50/contents?per_page=100`
    );

    return items
      .filter((item) => item.type === 'dir')
      .map((item) => item.name)
      .filter((name) => !name.startsWith('.'));
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

 // List repos the authenticated user owns in org 
export async function discoverClassroomsFromRepos(
  token: string,
  org: string,
  login: string
): Promise<string[]> {
  let repos: GitHubRepo[];
  try {
    repos = await ghFetch<GitHubRepo[]>(
      token,
      `search/repositories?q=user:${encodeURIComponent(org)}+${encodeURIComponent(login)}&per_page=100`
    );
  } catch {
    return [];
  }

  const suffix = `-${login.toLowerCase()}`;
  const classrooms = new Set<string>();

  for (const repo of repos) {
    const name = repo.name.toLowerCase();
    if (!name.endsWith(suffix)) {
      continue;
    }
    // Strip the trailing -<login> suffix, then take everything up to the last
    // hyphen-delimited segment (the assignment slug), leaving the classroom slug.
    const withoutLogin = name.slice(0, name.length - suffix.length);
    const lastHyphen = withoutLogin.lastIndexOf('-');
    if (lastHyphen > 0) {
      classrooms.add(withoutLogin.slice(0, lastHyphen));
    }
  }

  return [...classrooms];
}

 // Returns the html_url of the accepted assignment repo, or undefined if it doesn't exist yet.
export async function findAcceptedRepoUrl(
  token: string,
  org: string,
  classroom: string,
  assignment: string,
  login: string
): Promise<string | undefined> {
  const repoName = assignmentRepoName(classroom, assignment, login);
  try {
    const repo = await ghFetch<GitHubRepo>(
      token,
      `repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}`
    );
    return repo.html_url;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

export function assignmentRepoName(
  classroom: string,
  assignment: string,
  login: string
): string {
  return `${classroom.toLowerCase()}-${assignment.toLowerCase()}-${login.toLowerCase()}`;
}

export function parseGroupRepoFounder(
  repoName: string,
  classroom: string,
  assignment: string
): string | undefined {
  const prefix = `${classroom.toLowerCase()}-${assignment.toLowerCase()}-`;
  const loweredName = repoName.toLowerCase();
  if (!loweredName.startsWith(prefix)) {
    return undefined;
  }
  const founder = loweredName.slice(prefix.length).trim();
  return founder || undefined;
}

export function listGroupReposForAssignment(
  repos: GitHubRepo[],
  classroom: string,
  assignment: string,
  siblingSlugs: string[] = []
): GitHubRepo[] {
  const classroomLower = classroom.toLowerCase();
  const assignmentLower = assignment.toLowerCase();
  const prefix = `${classroomLower}-${assignmentLower}-`;
  const overlapPrefixes = siblingSlugs
    .map((slug) => slug.toLowerCase())
    .filter((slug) => slug !== assignmentLower)
    .map((slug) => `${classroomLower}-${slug}-`)
    .filter((siblingPrefix) => siblingPrefix.startsWith(prefix));

  return repos.filter((repo) => {
    const name = repo.name.toLowerCase();
    if (!name.startsWith(prefix)) {
      return false;
    }
    if (overlapPrefixes.some((siblingPrefix) => name.startsWith(siblingPrefix))) {
      return false;
    }
    return Boolean(name.slice(prefix.length));
  });
}

export function findGroupMembershipRepo(
  repos: GitHubRepo[],
  classroom: string,
  assignment: string,
  login: string,
  siblingSlugs: string[] = []
): GitHubRepo | undefined {
  const ownRepo = assignmentRepoName(classroom, assignment, login);
  return listGroupReposForAssignment(repos, classroom, assignment, siblingSlugs).find(
    (repo) => repo.name.toLowerCase() !== ownRepo
  );
}

type RepoCollaborator = {
  login: string;
};

export async function getRepoCollaboratorLogins(
  token: string,
  owner: string,
  repo: string
): Promise<string[]> {
  try {
    const collaborators = await ghFetch<RepoCollaborator[]>(
      token,
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators?per_page=100`
    );
    return collaborators
      .map((collaborator) => collaborator.login?.trim())
      .filter((login): login is string => Boolean(login));
  } catch (err) {
    if (err instanceof GitHubError && (err.status === 403 || err.status === 404)) {
      return [];
    }
    throw err;
  }
}

export type OrgMembershipStatus = {
  state: 'active' | 'pending';
};

export function validateOrgAccess(
  org: string,
  orgInfo: GitHubOrg | null,
  membership: OrgMembershipStatus | null
): string | undefined {
  if (!orgInfo) {
    return `Organization "${org}" was not found on GitHub.`;
  }

  if (!membership) {
    return `You do not appear to belong to "${org}" yet. Ask an owner to invite you.`;
  }

  if (membership.state === 'pending') {
    return `Your membership in "${org}" is still pending. Accept the invitation first.`;
  }

  return undefined;
}

export async function getOrgMembership(
  token: string,
  org: string
): Promise<OrgMembershipStatus | null> {
  try {
    return await ghFetch<OrgMembershipStatus>(
      token,
      `user/memberships/orgs/${encodeURIComponent(org)}`
    );
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function acceptOrgInvite(token: string, org: string): Promise<void> {
  await ghFetch<void>(token, `user/memberships/orgs/${encodeURIComponent(org)}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'active' }),
  });
}

export type GeneratedRepo = {
  name: string;
  full_name: string;
  html_url: string;
  default_branch?: string;
};

type RepoInfo = {
  default_branch?: string;
};

export type RepoFeatureSettings = {
  has_issues?: boolean;
  has_wiki?: boolean;
  has_projects?: boolean;
  has_pull_requests?: boolean;
};

export async function getRepoDefaultBranch(
  token: string,
  owner: string,
  repo: string
): Promise<string | undefined> {
  try {
    const info = await ghFetch<RepoInfo>(
      token,
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    );
    return info.default_branch;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function getRepoFeatureSettings(
  token: string,
  owner: string,
  repo: string
): Promise<RepoFeatureSettings | undefined> {
  try {
    const info = await ghFetch<RepoFeatureSettings>(
      token,
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    );
    return {
      has_issues: typeof info.has_issues === 'boolean' ? info.has_issues : undefined,
      has_wiki: typeof info.has_wiki === 'boolean' ? info.has_wiki : undefined,
      has_projects: typeof info.has_projects === 'boolean' ? info.has_projects : undefined,
      has_pull_requests:
        typeof info.has_pull_requests === 'boolean' ? info.has_pull_requests : undefined,
    };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

type ReleaseInfo = {
  name: string | null;
  tag_name: string;
  body: string | null;
  html_url: string;
};

export async function getLatestReleaseNotes(
  token: string,
  owner: string,
  repo: string
): Promise<string | undefined> {
  try {
    const release = await ghFetch<ReleaseInfo>(
      token,
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`
    );
    return release.body?.trim() || undefined;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function createRepoFromTemplate(
  token: string,
  templateOwner: string,
  templateRepo: string,
  targetOrg: string,
  newName: string
): Promise<{ repo: GeneratedRepo; alreadyExists: boolean }> {
  try {
    const repo = await ghFetch<GeneratedRepo>(
      token,
      `repos/${encodeURIComponent(templateOwner)}/${encodeURIComponent(templateRepo)}/generate`,
      {
        method: 'POST',
        body: JSON.stringify({ owner: targetOrg, name: newName, private: true }),
      }
    );
    return { repo, alreadyExists: false };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 422) {
      // Already exists — fetch the existing repo.
      const repo = await ghFetch<GeneratedRepo>(
        token,
        `repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(newName)}`
      );
      return { repo, alreadyExists: true };
    }
    if (err instanceof GitHubError && err.status === 404) {
      throw new Error(
        `Template \`${templateOwner}/${templateRepo}\` is not accessible — ask your instructor to make it public or grant your account access.`
      );
    }
    throw err;
  }
}

export async function createEmptyPrivateRepo(
  token: string,
  targetOrg: string,
  newName: string,
  autoInit = true
): Promise<{ repo: GeneratedRepo; alreadyExists: boolean }> {
  try {
    const repo = await ghFetch<GeneratedRepo>(
      token,
      `orgs/${encodeURIComponent(targetOrg)}/repos`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: newName,
          private: true,
          auto_init: autoInit,
        }),
      }
    );
    return { repo, alreadyExists: false };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 422) {
      const repo = await ghFetch<GeneratedRepo>(
        token,
        `repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(newName)}`
      );
      return { repo, alreadyExists: true };
    }
    throw err;
  }
}

export async function patchRepo(
  token: string,
  owner: string,
  repo: string,
  patch: Record<string, unknown>
): Promise<void> {
  await ghFetch<void>(token, `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function addCollaborator(
  token: string,
  owner: string,
  repo: string,
  username: string,
  permission: string
): Promise<void> {
  await ghFetch<void>(
    token,
    `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}`,
    { method: 'PUT', body: JSON.stringify({ permission }) }
  );
}

type BranchInfo = {
  commit: { sha: string; commit: { tree: { sha: string } } };
};

type GitBlob = {
  sha: string;
};

type GitTree = {
  sha: string;
};

type GitCommit = {
  sha: string;
};

type PullRequestInfo = {
  number: number;
  html_url: string;
};

type PullRequestListItem = {
  number: number;
};

type GitRefInfo = {
  object: {
    sha: string;
  };
};

type GitCommitInfo = {
  tree: {
    sha: string;
  };
};

type FeedbackLabel = {
  name: string;
  color: string;
};

export const FEEDBACK_BASE_BRANCH = 'feedback';
export const FEEDBACK_PR_TITLE = 'Feedback';
export const FEEDBACK_LABEL_DESCRIPTION = 'Classroom 50 teacher-managed feedback PR';
export const FEEDBACK_OPEN_COMMIT_MESSAGE = '[Classroom 50] Open Feedback PR (gh student accept)\n\n[skip ci]';

export type EnsureFeedbackPullRequestResult =
  | { ok: true; created: boolean; url?: string }
  | { ok: false; reason: string };

class FeedbackBaseMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedbackBaseMismatchError';
  }
}

function feedbackLabelForMode(mode: string): FeedbackLabel {
  if (mode.trim().toLowerCase() === 'group') {
    return { name: 'Group Assignment', color: '5319E7' };
  }
  return { name: 'Individual Assignment', color: '0E8A16' };
}

function feedbackPrBody(head: string, releaseUrl: string): string {
  return [
    ':wave:! Classroom 50 opened this pull request as a place for your teacher to leave feedback on your work. It stays up to date automatically as you push. **Don\'t close or merge this pull request** unless your teacher tells you to.',
    '',
    `Each commit is automatically graded - the latest autograding result is [here](${releaseUrl}).`,
    '',
    'Your teacher can leave comments and feedback on your code here. Click the **Subscribe** button to be notified when that happens.',
    '',
    `Open the **Files changed** or **Commits** tab to see everything you\'ve pushed to \`${head}\` since you accepted the assignment - your teacher sees the same view.`,
    '',
    '<details>',
    '<summary><strong>Notes for teachers</strong></summary>',
    '',
    'Use this PR to leave feedback:',
    '',
    `- **Files changed** shows the full diff on \`${head}\` since the student accepted. Hover a line and click the blue **+** to leave a line comment.`,
    '- **Commits** lists each pushed commit; open one to see its changes.',
    '- Autograde results appear as the `classroom50/autograde` commit status / check on each submission.',
    `- The [latest autograding result](${releaseUrl}) has the per-test detail behind that status.`,
    '- This page is an overview - commits, line comments, and a general comment box below.',
    '',
    `The base branch (\`${FEEDBACK_BASE_BRANCH}\`) is frozen at the starter so the diff always reflects the full body of work. The PR is kept up to date automatically; merging it is the teacher-side "grading done" signal.`,
    '</details>',
  ].join('\n');
}

function isNoCommitsBetweenError(err: unknown): boolean {
  if (!(err instanceof GitHubError) || err.status !== 422) {
    return false;
  }
  return err.message.toLowerCase().includes('no commits between');
}

function isPullRequestAlreadyExistsError(err: unknown): boolean {
  if (!(err instanceof GitHubError) || err.status !== 422) {
    return false;
  }
  return err.message.toLowerCase().includes('a pull request already exists');
}

function isRetryableFreshRepoError(err: unknown): boolean {
  if (!(err instanceof GitHubError)) {
    return false;
  }
  return err.status === 404 || err.status === 409 || err.status >= 500;
}

async function listPullRequestsByBaseHead(
  token: string,
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<PullRequestListItem[]> {
  return ghFetch<PullRequestListItem[]>(
    token,
    `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${head}`)}`
  );
}

async function createBranchRef(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  sha: string
): Promise<boolean> {
  try {
    await ghFetch<void>(token, `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
    return true;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 422) {
      return false;
    }
    throw err;
  }
}

async function getBranchRefSha(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const ref = await ghFetch<GitRefInfo>(
    token,
    `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  return ref.object.sha;
}

async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<PullRequestInfo> {
  const releaseUrl = `https://github.com/${owner}/${repo}/releases/latest`;
  return ghFetch<PullRequestInfo>(token, `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      base,
      head,
      title: FEEDBACK_PR_TITLE,
      body: feedbackPrBody(head, releaseUrl),
    }),
  });
}

async function createEmptyCommitAndFastForward(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<void> {
  const base = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headSha = await getBranchRefSha(token, owner, repo, branch);
  const headCommit = await ghFetch<GitCommitInfo>(token, `${base}/git/commits/${encodeURIComponent(headSha)}`);
  const emptyCommit = await ghFetch<GitCommit>(token, `${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: FEEDBACK_OPEN_COMMIT_MESSAGE,
      tree: headCommit.tree.sha,
      parents: [headSha],
    }),
  });

  await ghFetch<void>(token, `${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: emptyCommit.sha, force: false }),
  });
}

async function ensureFeedbackLabel(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  mode: string
): Promise<void> {
  const label = feedbackLabelForMode(mode);
  try {
    await ghFetch<void>(token, `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`, {
      method: 'POST',
      body: JSON.stringify({
        name: label.name,
        color: label.color,
        description: FEEDBACK_LABEL_DESCRIPTION,
      }),
    });
  } catch (err) {
    if (!(err instanceof GitHubError) || err.status !== 422) {
      throw err;
    }
  }

  await ghFetch<void>(
    token,
    `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${prNumber}/labels`,
    {
      method: 'POST',
      body: JSON.stringify({ labels: [label.name] }),
    }
  );
}

async function ensureFeedbackPullRequestOnce(params: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  acceptCommitSha: string;
  mode: string;
}): Promise<EnsureFeedbackPullRequestResult> {
  const { token, owner, repo, branch, acceptCommitSha, mode } = params;

  const existing = await listPullRequestsByBaseHead(token, owner, repo, FEEDBACK_BASE_BRANCH, branch);
  if (existing.length > 0) {
    return { ok: true, created: false };
  }

  const created = await createBranchRef(token, owner, repo, FEEDBACK_BASE_BRANCH, acceptCommitSha);
  if (!created) {
    const existingBaseSha = await getBranchRefSha(token, owner, repo, FEEDBACK_BASE_BRANCH);
    if (existingBaseSha !== acceptCommitSha) {
      throw new FeedbackBaseMismatchError(
        `${FEEDBACK_BASE_BRANCH} branch is at ${existingBaseSha}, not the expected baseline ${acceptCommitSha} - an org admin must delete it so it can be re-frozen correctly`
      );
    }
  }

  const raceOrThrow = async (createErr: unknown): Promise<PullRequestInfo> => {
    if (!isPullRequestAlreadyExistsError(createErr)) {
      throw createErr;
    }
    const raced = await listPullRequestsByBaseHead(token, owner, repo, FEEDBACK_BASE_BRANCH, branch);
    if (raced.length === 0) {
      throw createErr;
    }
    return {
      number: raced[0].number,
      html_url: `https://github.com/${owner}/${repo}/pull/${raced[0].number}`,
    };
  };

  let pr: PullRequestInfo;
  try {
    pr = await createPullRequest(token, owner, repo, FEEDBACK_BASE_BRANCH, branch);
  } catch (err) {
    if (!isNoCommitsBetweenError(err)) {
      pr = await raceOrThrow(err);
    } else {
      await createEmptyCommitAndFastForward(token, owner, repo, branch);
      try {
        pr = await createPullRequest(token, owner, repo, FEEDBACK_BASE_BRANCH, branch);
      } catch (retryErr) {
        pr = await raceOrThrow(retryErr);
      }
    }
  }

  try {
    await ensureFeedbackLabel(token, owner, repo, pr.number, mode);
  } catch {
    // Labeling is best-effort; the PR itself is already in place.
  }

  return { ok: true, created: true, url: pr.html_url };
}

export async function ensureFeedbackPullRequest(params: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  acceptCommitSha: string;
  mode: string;
}): Promise<EnsureFeedbackPullRequestResult> {
  const attempts = 3;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await ensureFeedbackPullRequestOnce(params);
    } catch (err) {
      if (err instanceof FeedbackBaseMismatchError) {
        return { ok: false, reason: err.message };
      }
      lastError = err;
      if (!isRetryableFreshRepoError(err) || i === attempts - 1) {
        break;
      }
      await sleep(300 * (i + 1));
    }
  }

  const reason = lastError instanceof Error ? lastError.message : 'Unexpected error';
  return { ok: false, reason };
}

export async function waitForStableBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<void> {
  let lastSha = '';
  for (let i = 0; i < 20; i++) {
    await sleep(500 + i * 250);
    try {
      const info = await ghFetch<BranchInfo>(
        token,
        `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`
      );
      const sha = info.commit?.sha ?? '';
      if (sha && sha === lastSha) {
        return;
      }
      lastSha = sha;
    } catch {
      lastSha = '';
    }
  }
  throw new Error(`Branch ${owner}/${repo}:${branch} did not stabilise after 20 attempts.`);
}

export async function commitFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  files: Record<string, string>
): Promise<string> {
  const base = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // 1. Get the current commit + tree SHA
  const branchInfo = await ghFetch<BranchInfo>(token, `${base}/branches/${encodeURIComponent(branch)}`);
  const parentSha = branchInfo.commit.sha;
  const baseTreeSha = branchInfo.commit.commit.tree.sha;

  // 2. Upload blobs
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await ghFetch<GitBlob>(token, `${base}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'utf-8' }),
    });
    treeEntries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 3. Create tree
  const tree = await ghFetch<GitTree>(token, `${base}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });

  // 4. Create commit
  const commit = await ghFetch<GitCommit>(token, `${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
  });

  // 5. Update ref
  await ghFetch<void>(token, `${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });

  return commit.sha;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Render .classroom50.yaml using the official repo-config YAML format. */
export function renderClassroomMetadata(cfg: ClassroomConfig): string {
  const lines: string[] = [];

  if (cfg.schema) {
    lines.push(`schema: "${cfg.schema}"`);
  }

  lines.push(`classroom: "${cfg.classroom}"`, `assignment: "${cfg.assignment}"`);

  if (cfg.owner) {
    lines.push('owner:');
    lines.push(`  username: "${cfg.owner.username}"`);
    if (cfg.owner.id !== undefined) {
      lines.push(`  id: ${cfg.owner.id}`);
    }
    if (cfg.owner.acceptedAt) {
      lines.push(`  accepted_at: "${cfg.owner.acceptedAt}"`);
    }
  }

  if (cfg.source) {
    lines.push(
      'source:',
      `  owner: "${cfg.source.owner}"`,
      `  repo: "${cfg.source.repo}"`,
      `  branch: "${cfg.source.branch}"`
    );
  }

  return lines.join('\n') + '\n';
}
