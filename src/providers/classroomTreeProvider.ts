import * as vscode from 'vscode';
import { getGitHubSession } from '../auth/authProvider';
import {
  getUser,
  findAcceptedRepoUrl,
  getLatestReleaseNotes,
} from '../api/classroomApi';
import { fetchAssignments, isValidAccessKey } from '../api/pagesApi';
import { AssignmentEntry, AssignmentInfo } from '../types';

function isPagesNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return err.message.includes('returned 404');
}

export class OrgItem extends vscode.TreeItem {
  readonly kind = 'org' as const;
  constructor(public readonly org: string) {
    super(org, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'org';
    this.iconPath = new vscode.ThemeIcon('organization');
    this.tooltip = `GitHub org: ${org}`;
  }
}

export class ClassroomItem extends vscode.TreeItem {
  readonly kind = 'classroom' as const;
  constructor(
    public readonly org: string,
    public readonly classroom: string
  ) {
    super(classroom, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'classroom';
    this.iconPath = new vscode.ThemeIcon('book');
    this.description = org;
    this.tooltip = `${org}/${classroom}`;
  }
}

export class AssignmentItem extends vscode.TreeItem {
  readonly kind = 'assignment' as const;
  readonly assignmentInfo: AssignmentInfo;

  constructor(info: AssignmentInfo) {
    const label = info.entry.name || info.entry.slug;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.assignmentInfo = info;
    this.contextValue = `assignment-${info.status}`;
    this.description =
      info.status === 'submitted'
        ? '✓ submitted'
        : info.status === 'accepted'
        ? '✓ accepted'
        : 'not accepted';
    this.tooltip = `${info.org}/${info.classroom}/${info.entry.slug}\nTemplate: ${info.entry.template.owner}/${info.entry.template.repo}`;

    this.iconPath =
      info.status === 'pending'
        ? new vscode.ThemeIcon('circle-outline')
        : new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));

    this.command = {
      command: 'classroom50.openDetail',
      title: 'Open Assignment',
      arguments: [this],
    };
  }
}

export class MessageItem extends vscode.TreeItem {
  constructor(label: string, icon?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}

export class ActionItem extends vscode.TreeItem {
  constructor(label: string, command: string, args: unknown[] = []) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'action';
    this.iconPath = new vscode.ThemeIcon('add');
    this.command = {
      command,
      title: label,
      arguments: args,
    };
  }
}

export type ClassroomTreeItem = OrgItem | ClassroomItem | AssignmentItem | MessageItem | ActionItem;

export class ClassroomTreeProvider
  implements vscode.TreeDataProvider<ClassroomTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<ClassroomTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ClassroomTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ClassroomTreeItem): Promise<ClassroomTreeItem[]> {
    const session = await getGitHubSession(false);

    if (!element) {
      // Root level: show sign-in prompt if not authenticated
      if (!session) {
        const item = new MessageItem('Sign in to GitHub to get started', 'github');
        item.command = { command: 'classroom50.login', title: 'Sign in' };
        return [item];
      }
      return this.getRootOrgs(session.accessToken);
    }

    if (!session) {
      return [];
    }

    if (element instanceof OrgItem) {
      return this.getClassroomsForOrg(session.accessToken, element.org);
    }

    if (element instanceof ClassroomItem) {
      return this.getAssignmentsForClassroom(
        session.accessToken,
        element.org,
        element.classroom
      );
    }

    return [];
  }

  private async getRootOrgs(token: string): Promise<ClassroomTreeItem[]> {
    const settingsOrgs: string[] =
      vscode.workspace.getConfiguration('classroom50').get<string[]>('orgs') ?? [];

    if (settingsOrgs.length === 0) {
      return [
        new MessageItem('No organizations added yet', 'info'),
        new ActionItem('Add organization…', 'classroom50.addOrg'),
      ];
    }

    return [...new Set(settingsOrgs.map((org) => org.trim()).filter(Boolean))].map(
      (org) => new OrgItem(org)
    );
  }

  private async getClassroomsForOrg(
    token: string,
    org: string
  ): Promise<ClassroomTreeItem[]> {
    const storeKey = `classrooms:${org}`;
    const stored = [...new Set((this.context.globalState.get<string[]>(storeKey) ?? []).map((entry) => entry.trim()).filter(Boolean))];

    if (stored.length === 0) {
      return [
        new MessageItem('No classrooms found in this org', 'info'),
        new ActionItem('Add classroom…', 'classroom50.addClassroom', [new OrgItem(org)]),
      ];
    }

    return stored.map((c) => new ClassroomItem(org, c));
  }

  private async getAssignmentsForClassroom(
    token: string,
    org: string,
    classroom: string
  ): Promise<ClassroomTreeItem[]> {
    const accessKeyStorageKey = this.classroomAccessKeyStoreKey(org, classroom);
    const savedAccessKey = this.context.globalState.get<string>(accessKeyStorageKey);

    let entries: AssignmentEntry[];
    try {
      entries = await fetchAssignments(org, classroom, savedAccessKey);
    } catch (err: unknown) {
      if (isPagesNotFoundError(err)) {
        const accessKey = await this.promptForAccessKey(org, classroom);
        if (!accessKey) {
          return [new MessageItem('Classroom is unlisted. Enter the classroom key to view assignments.', 'key')];
        }

        try {
          entries = await fetchAssignments(org, classroom, accessKey);
          await this.context.globalState.update(accessKeyStorageKey, accessKey);
        } catch {
          return [
            new MessageItem(
              'Classroom is unlisted and the key was rejected. Re-open the classroom and try again.',
              'error'
            ),
          ];
        }
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        return [new MessageItem(`Error: ${msg}`, 'error')];
      }
    }

    if (entries.length === 0) {
      return [new MessageItem('No assignments published yet', 'info')];
    }

    let login: string;
    try {
      const user = await getUser(token);
      login = user.login;
    } catch {
      login = '';
    }

    const items = await Promise.all(
      entries.map(async (entry) => {
        let repoUrl: string | undefined;
        let releaseNotes: string | undefined;
        if (login) {
          repoUrl = await findAcceptedRepoUrl(token, org, classroom, entry.slug, login).catch(
            () => undefined
          );
          if (repoUrl) {
            const repoName = `${classroom.toLowerCase()}-${entry.slug.toLowerCase()}-${login.toLowerCase()}`;
            releaseNotes = await getLatestReleaseNotes(token, org, repoName).catch(() => undefined);
          }
        }
        const info: AssignmentInfo = {
          entry,
          org,
          classroom,
          status: repoUrl ? (releaseNotes ? 'submitted' : 'accepted') : 'pending',
          repoUrl,
          releaseNotes,
        };
        return new AssignmentItem(info);
      })
    );

    return items;
  }

  private classroomAccessKeyStoreKey(org: string, classroom: string): string {
    return `classroom-access-key:${org.toLowerCase()}/${classroom.toLowerCase()}`;
  }

  private async promptForAccessKey(org: string, classroom: string): Promise<string | undefined> {
    const key = await vscode.window.showInputBox({
      title: 'Classroom Access Key Required',
      prompt: `The classroom ${org}/${classroom} is unlisted. Paste the key from your invitation link (?k=...).`,
      placeHolder: 'Example from invite URL: ?k=abc123xy',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) {
          return 'Access key is required.';
        }
        if (!isValidAccessKey(value.trim())) {
          return 'Access key must be 4-64 lowercase letters or digits.';
        }
        return undefined;
      },
    });

    return key?.trim();
  }

  // Save a classroom slug under an org so it persists across reloads
  async addClassroom(org: string, classroom: string): Promise<void> {
    const key = `classrooms:${org}`;
    const existing = this.context.globalState.get<string[]>(key) ?? [];
    const trimmedClassroom = classroom.trim();
    if (!existing.some((entry) => entry.trim().toLowerCase() === trimmedClassroom.toLowerCase())) {
      await this.context.globalState.update(key, [...existing, trimmedClassroom]);
    }
  }

  async removeClassroom(org: string, classroom: string): Promise<void> {
    const key = `classrooms:${org}`;
    const existing = this.context.globalState.get<string[]>(key) ?? [];
    const remaining = existing.filter(
      (entry) => entry.trim().toLowerCase() !== classroom.trim().toLowerCase()
    );
    await this.context.globalState.update(key, remaining.length > 0 ? remaining : undefined);
  }
}
