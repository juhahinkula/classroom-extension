import * as vscode from 'vscode';
import { getGitHubSession } from '../auth/authProvider';
import {
  getUser,
  listClassroomsFromConfigRepo,
  discoverClassroomsFromRepos,
  findAcceptedRepoUrl,
  getLatestReleaseNotes,
} from '../api/classroomApi';
import { fetchAssignments } from '../api/pagesApi';
import { AssignmentEntry, AssignmentInfo } from '../types';

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
    this.description = info.status === 'accepted' ? '✓ accepted' : 'not accepted';
    this.tooltip = `${info.org}/${info.classroom}/${info.entry.slug}\nTemplate: ${info.entry.template.owner}/${info.entry.template.repo}`;

    this.iconPath =
      info.status === 'accepted'
        ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon('circle-outline');

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
    // Stored classrooms (manually added or previously discovered)
    const storeKey = `classrooms:${org}`;
    const stored: string[] =
      this.context.globalState.get<string[]>(storeKey) ?? [];

    let discovered: string[] = [];
    let discoveryError: string | undefined;
    try {
      const user = await getUser(token);
      const fromConfigRepo = await listClassroomsFromConfigRepo(token, org);
      const fromRepos = await discoverClassroomsFromRepos(token, org, user.login);
      discovered = [...new Set([...fromConfigRepo, ...fromRepos])];
    } catch (err: unknown) {
      discoveryError = err instanceof Error ? err.message : String(err);
    }

    const combined = [...new Set([...stored, ...discovered])];

    // Save discovered classrooms
    if (discovered.length > 0) {
      await this.context.globalState.update(storeKey, combined);
    }

    if (combined.length === 0) {
      const items: ClassroomTreeItem[] = [];
      if (discoveryError) {
        items.push(new MessageItem(`Could not load classrooms: ${discoveryError}`, 'error'));
      }
      items.push(new MessageItem('No classrooms found in this org', 'info'));
      items.push(new ActionItem('Add classroom…', 'classroom50.addClassroom', [new OrgItem(org)]));
      return items;
    }

    return combined.map((c) => new ClassroomItem(org, c));
  }

  private async getAssignmentsForClassroom(
    token: string,
    org: string,
    classroom: string
  ): Promise<ClassroomTreeItem[]> {
    let entries: AssignmentEntry[];
    try {
      entries = await fetchAssignments(org, classroom);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return [new MessageItem(`Error: ${msg}`, 'error')];
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
          status: repoUrl ? 'accepted' : 'pending',
          repoUrl,
          releaseNotes,
        };
        return new AssignmentItem(info);
      })
    );

    return items;
  }

  // Save a classroom slug under an org so it persists across reloads
  async addClassroom(org: string, classroom: string): Promise<void> {
    const key = `classrooms:${org}`;
    const existing = this.context.globalState.get<string[]>(key) ?? [];
    if (!existing.includes(classroom)) {
      await this.context.globalState.update(key, [...existing, classroom]);
    }
  }
}
