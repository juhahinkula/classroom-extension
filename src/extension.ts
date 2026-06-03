import * as vscode from 'vscode';
import { ClassroomTreeProvider, AssignmentItem, OrgItem } from './providers/classroomTreeProvider';
import { AssignmentPanel } from './webview/assignmentPanel';
import { loginCommand, logoutCommand } from './commands/login';
import { acceptAssignment } from './commands/accept';
import { AssignmentInfo } from './types';

export function activate(context: vscode.ExtensionContext) {
  const treeProvider = new ClassroomTreeProvider(context);

  // Register the tree view
  const treeView = vscode.window.createTreeView('classroom50', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ── Commands ──────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('classroom50.login', loginCommand),
    vscode.commands.registerCommand('classroom50.logout', logoutCommand),

    vscode.commands.registerCommand('classroom50.refresh', () => {
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('classroom50.addOrg', async () => {
      const org = await vscode.window.showInputBox({
        prompt: 'Enter the GitHub organization name',
        placeHolder: 'e.g. cs50',
        validateInput: (v) => (v.trim() ? undefined : 'Organization name cannot be empty'),
      });
      if (!org) {
        return;
      }
      const config = vscode.workspace.getConfiguration('classroom50');
      const current = config.get<string[]>('orgs') ?? [];
      if (!current.includes(org.trim())) {
        await config.update(
          'orgs',
          [...current, org.trim()],
          vscode.ConfigurationTarget.Global
        );
      }
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('classroom50.addClassroom', async (item?: OrgItem) => {
      let org = item?.org;
      if (!org) {
        org = await vscode.window.showInputBox({
          prompt: 'Enter the GitHub organization name',
          placeHolder: 'e.g. cs50',
        });
      }
      if (!org) {
        return;
      }
      const classroom = await vscode.window.showInputBox({
        prompt: `Enter the classroom slug for org "${org}"`,
        placeHolder: 'e.g. cs50-fall-2026',
        validateInput: (v) => (v.trim() ? undefined : 'Classroom name cannot be empty'),
      });
      if (!classroom) {
        return;
      }
      await treeProvider.addClassroom(org, classroom.trim());
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('classroom50.openDetail', (item: AssignmentItem) => {
      AssignmentPanel.open(item.assignmentInfo, handleAccept);
    }),

    vscode.commands.registerCommand('classroom50.accept', async (item: AssignmentItem) => {
      await handleAccept(item.assignmentInfo);
    }),

    vscode.commands.registerCommand('classroom50.openOnGitHub', (item: AssignmentItem) => {
      const url = item.assignmentInfo.repoUrl;
      if (url) {
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    })
  );

  // Refresh tree when auth state changes
  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === 'github') {
        treeProvider.refresh();
      }
    })
  );

  // ── Accept handler (shared by tree command + webview) ─────────────────────

  async function handleAccept(info: AssignmentInfo): Promise<void> {
    try {
      const repoUrl = await acceptAssignment(info);
      if (repoUrl) {
        // Refresh tree so the assignment shows as accepted
        treeProvider.refresh();
        // Update the open webview panel if any
        const updatedInfo: AssignmentInfo = { ...info, status: 'accepted', repoUrl };
        AssignmentPanel.open(updatedInfo, handleAccept).update(updatedInfo);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Accept failed: ${msg}`);
      // Let the webview re-enable its button
      AssignmentPanel.open(info, handleAccept).notifyError();
    }
  }
}

export function deactivate() {}

