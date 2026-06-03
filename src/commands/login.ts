import * as vscode from 'vscode';
import { requireGitHubSession, getGitHubSession } from '../auth/authProvider';
import { getUser } from '../api/classroomApi';

export async function loginCommand(): Promise<void> {
  try {
    const session = await requireGitHubSession();
    const user = await getUser(session.accessToken);
    vscode.window.showInformationMessage(
      `Signed in to GitHub as ${user.login}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Sign-in failed: ${msg}`);
  }
}

export async function logoutCommand(): Promise<void> {
  const session = await getGitHubSession(false);
  if (!session) {
    vscode.window.showInformationMessage('Not currently signed in to GitHub.');
    return;
  }

  vscode.window.showInformationMessage(
    'To sign out, use the Accounts menu (bottom-left of VS Code)'
  );
}
