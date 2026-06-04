/*
  Authentication is using VS Code's Github authentication provider.
  The session object contains authToken that is used in the extentions.

  For example,
  const session = await requireGitHubSession();
  const token = session.accessToken;
*/
import * as vscode from 'vscode';

const GITHUB_AUTH_PROVIDER_ID = 'github';
// read:org — org membership lookup + invite accept
// repo     — create repos, write files via git-data API
// read:user — get login/email for commit author
// workflow - needed in the accept phase due to autgrading
const SCOPES = ['read:org', 'repo', 'read:user', 'workflow'];

export async function getGitHubSession(
  createIfNone = false
): Promise<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession(GITHUB_AUTH_PROVIDER_ID, SCOPES, {
    createIfNone,
  });
}

export async function requireGitHubSession(): Promise<vscode.AuthenticationSession> {
  const session = await getGitHubSession(true);
  if (!session) {
    throw new Error(
      'GitHub sign-in is required. Run "Classroom50: Sign in to GitHub" to authenticate.'
    );
  }
  return session;
}
