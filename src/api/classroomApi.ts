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

 // Not in use either
 // Return true when the org has a classroom50 config repo. Note! works only with public repos
export async function hasClassroomConfigRepo(
  token: string,
  org: string
): Promise<boolean> {
  try {
    await ghFetch<RepoContentItem>(
      token,
      `repos/${encodeURIComponent(org)}/classroom50`
    );
    return true;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return false;
    }
    throw err;
  }
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
  default_branch: string;
};

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
): Promise<void> {
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Render .classroom50.yaml matching the CLI's double-quoted YAML format. */
export function renderClassroomMetadata(cfg: ClassroomConfig): string {
  return [
    `classroom: "${cfg.classroom}"`,
    `assignment: "${cfg.assignment}"`,
    `source:`,
    `  owner: "${cfg.source.owner}"`,
    `  repo: "${cfg.source.repo}"`,
    `  branch: "${cfg.source.branch}"`,
  ].join('\n') + '\n';
}
