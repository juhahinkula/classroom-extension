import * as vscode from 'vscode';
import { ClassroomTreeProvider, AssignmentItem, ClassroomItem, OrgItem } from './providers/classroomTreeProvider';
import { AssignmentPanel } from './webview/assignmentPanel';
import { loginCommand, logoutCommand } from './commands/login';
import { acceptAssignment } from './commands/accept';
import { requireGitHubSession } from './auth/authProvider';
import { getOrg, getOrgMembership, validateOrgAccess } from './api/classroomApi';
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

    // User can add a new organization. After that we check that user belongs to typed organization.
    // Note! This adds organization only to VS Code persistent state.
    vscode.commands.registerCommand('classroom50.addOrg', async () => {
      const org = await vscode.window.showInputBox({
        prompt: 'Enter the GitHub organization name',
        placeHolder: 'e.g. cs50',
        validateInput: (v) => (v.trim() ? undefined : 'Organization name cannot be empty'),
      });
      if (!org) {
        return;
      }

      const trimmedOrg = org.trim();
      try {
        const session = await requireGitHubSession();
        const orgInfo = await getOrg(session.accessToken, trimmedOrg);
        const membership = await getOrgMembership(session.accessToken, trimmedOrg);
        const validationError = validateOrgAccess(trimmedOrg, orgInfo, membership);

        if (validationError) {
          vscode.window.showErrorMessage(validationError);
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Unable to verify organization "${trimmedOrg}": ${message}`);
        return;
      }

      const config = vscode.workspace.getConfiguration('classroom50');
      const current = config.get<string[]>('orgs') ?? [];
      if (!current.includes(trimmedOrg)) {
        await config.update(
          'orgs',
          [...current, trimmedOrg],
          vscode.ConfigurationTarget.Global
        );
      }
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('classroom50.removeOrg', async (item?: OrgItem) => {
      let org = item?.org;
      if (!org) {
        org = await vscode.window.showInputBox({
          prompt: 'Enter the GitHub organization name to remove',
          placeHolder: 'e.g. cs50',
        });
      }
      if (!org) {
        return;
      }

      const trimmedOrg = org.trim();
      const choice = await vscode.window.showWarningMessage(
        `Remove "${trimmedOrg}" from VS Code? This only removes it from your local VS Code settings — the organization on GitHub is not affected.`,
        { modal: true },
        'Remove'
      );
      if (choice !== 'Remove') {
        return;
      }

      const config = vscode.workspace.getConfiguration('classroom50');
      const current = config.get<string[]>('orgs') ?? [];
      await config.update(
        'orgs',
        current.filter((entry) => entry.trim().toLowerCase() !== trimmedOrg.toLowerCase()),
        vscode.ConfigurationTarget.Global
      );

      await context.globalState.update(`classrooms:${trimmedOrg}`, undefined);
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

      const trimmedOrg = org.trim();
      try {
        const session = await requireGitHubSession();
        const orgInfo = await getOrg(session.accessToken, trimmedOrg);
        const membership = await getOrgMembership(session.accessToken, trimmedOrg);
        const validationError = validateOrgAccess(trimmedOrg, orgInfo, membership);

        if (validationError) {
          vscode.window.showErrorMessage(validationError);
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Unable to verify organization "${trimmedOrg}": ${message}`);
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
      await treeProvider.addClassroom(trimmedOrg, classroom.trim());
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('classroom50.removeClassroom', async (item?: ClassroomItem) => {
      let org = item?.org;
      let classroom = item?.classroom;

      if (!org || !classroom) {
        const combined = await vscode.window.showInputBox({
          prompt: 'Enter the classroom slug to remove in the form org/classroom',
          placeHolder: 'e.g. cs50/cs50-fall-2026',
          validateInput: (v) => (v.trim() ? undefined : 'Classroom identifier cannot be empty'),
        });
        if (!combined) {
          return;
        }

        const parts = combined.split('/').map((part) => part.trim()).filter(Boolean);
        if (parts.length !== 2) {
          vscode.window.showErrorMessage('Enter the classroom as org/classroom.');
          return;
        }

        [org, classroom] = parts;
      }

      const trimmedOrg = org.trim();
      const trimmedClassroom = classroom.trim();
      const choice = await vscode.window.showWarningMessage(
        `Remove classroom "${trimmedClassroom}" from org "${trimmedOrg}" in VS Code? This only removes it from your local VS Code settings — the classroom on GitHub is not affected.`,
        { modal: true },
        'Remove'
      );
      if (choice !== 'Remove') {
        return;
      }

      await treeProvider.removeClassroom(trimmedOrg, trimmedClassroom);
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

