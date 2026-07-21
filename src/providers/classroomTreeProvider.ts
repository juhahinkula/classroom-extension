import * as vscode from 'vscode';
import { getGitHubSession } from '../auth/authProvider';
import {
  getUser,
  findAcceptedRepoUrl,
  getLatestReleaseNotes,
  assignmentRepoName,
  listUserReposInOrg,
  findGroupMembershipRepo,
  getRepoCollaboratorLogins,
  parseGroupRepoFounder,
} from '../api/classroomApi';
import { fetchAssignments, fetchClassroomsFromPages, isValidAccessKey } from '../api/pagesApi';
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
    public readonly classroom: string,
    public readonly classroomName?: string
  ) {
    super(classroomName || classroom, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'classroom';
    this.iconPath = new vscode.ThemeIcon('book');
    this.description = org;
    this.tooltip = classroomName && classroomName !== classroom
      ? `${classroomName} (${org}/${classroom})`
      : `${org}/${classroom}`;
  }
}

type StoredClassroom = {
  slug: string;
  name?: string;
};

export class AssignmentItem extends vscode.TreeItem {
  readonly kind = 'assignment' as const;
  readonly assignmentInfo: AssignmentInfo;

  constructor(info: AssignmentInfo) {
    const label = info.entry.name || info.entry.slug;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.assignmentInfo = info;
    this.contextValue = `assignment-${info.status}`;
    const statusText =
      info.status === 'submitted'
        ? '✓ submitted'
        : info.status === 'accepted'
        ? '✓ accepted'
        : info.status === 'group-member'
        ? 'already in group'
        : 'not accepted';
    const modeText = info.isGroupAssignment ? 'group' : 'individual';
    this.description = `${statusText} · ${modeText}`;

    const templateOwner = info.entry.template?.owner || 'unknown';
    const templateRepo = info.entry.template?.repo || 'unknown';
    const templateText = `Template: ${templateOwner}/${templateRepo}`;
    const modeDetail = info.isGroupAssignment
      ? `Mode: group${info.maxGroupSize ? ` (max ${info.maxGroupSize})` : ''}`
      : 'Mode: individual';
    const groupDetail = info.groupFounder ? `Group founder: ${info.groupFounder}` : '';
    this.tooltip = [
      `${info.org}/${info.classroom}/${info.entry.slug}`,
      modeDetail,
      groupDetail,
      templateText,
    ]
      .filter(Boolean)
      .join('\n');

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
    let stored = this.readStoredClassrooms(org);

    // Backfill names for legacy entries that were stored as plain slugs.
    if (stored.some((entry) => !entry.name)) {
      try {
        const listings = await fetchClassroomsFromPages(org);
        const namesBySlug = new Map(
          listings.map((listing) => [listing.slug.toLowerCase(), listing.name])
        );
        const enriched = stored.map((entry) => ({
          ...entry,
          name: entry.name || namesBySlug.get(entry.slug.toLowerCase()),
        }));

        const changed = enriched.some((entry, index) => entry.name !== stored[index].name);
        if (changed) {
          stored = enriched;
          await this.context.globalState.update(this.classroomStoreKey(org), enriched);
        }
      } catch {
        // Ignore enrichment failures and keep existing stored values.
      }
    }

    if (stored.length === 0) {
      return [
        new MessageItem('No classrooms found in this org', 'info'),
        new ActionItem('Add classroom…', 'classroom50.addClassroom', [new OrgItem(org)]),
      ];
    }

    return stored.map((c) => new ClassroomItem(org, c.slug, c.name));
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

    const siblingSlugs = entries.map((candidate) => candidate.slug);
    let memberRepos = [] as Awaited<ReturnType<typeof listUserReposInOrg>>;
    if (login) {
      memberRepos = await listUserReposInOrg(token, org).catch(() => []);
    }
    const memberReposByName = new Map(
      memberRepos.map((repo) => [repo.name.toLowerCase(), repo])
    );

    const items = await Promise.all(
      entries.map(async (entry) => {
        const mode = (entry.mode || 'individual').trim().toLowerCase();
        const isGroupAssignment = mode === 'group';
        let repoUrl: string | undefined;
        let releaseNotes: string | undefined;
        let groupRepoUrl: string | undefined;
        let groupRepoName: string | undefined;
        let groupFounder: string | undefined;
        let status: AssignmentInfo['status'] = 'pending';

        if (login) {
          const ownRepoName = assignmentRepoName(classroom, entry.slug, login);
          repoUrl = memberReposByName.get(ownRepoName)?.html_url;
          if (!repoUrl) {
            repoUrl = await findAcceptedRepoUrl(token, org, classroom, entry.slug, login).catch(
              () => undefined
            );
          }

          if (repoUrl) {
            status = 'accepted';
            const repoName = assignmentRepoName(classroom, entry.slug, login);
            releaseNotes = await getLatestReleaseNotes(token, org, repoName).catch(() => undefined);
            groupRepoUrl = isGroupAssignment ? repoUrl : undefined;
            groupRepoName = isGroupAssignment ? repoName : undefined;
            groupFounder = isGroupAssignment ? login.toLowerCase() : undefined;
          } else if (isGroupAssignment) {
            const memberRepo = findGroupMembershipRepo(
              memberRepos,
              classroom,
              entry.slug,
              login,
              siblingSlugs
            );
            if (memberRepo) {
              status = 'group-member';
              repoUrl = memberRepo.html_url;
              groupRepoUrl = memberRepo.html_url;
              groupRepoName = memberRepo.name;
              groupFounder = parseGroupRepoFounder(memberRepo.name, classroom, entry.slug);
            }
          }

          if (status === 'accepted' && releaseNotes) {
            status = 'submitted';
          }
        }

        let groupMembers: string[] | undefined;
        if (isGroupAssignment && groupRepoName) {
          groupMembers = await getRepoCollaboratorLogins(token, org, groupRepoName).catch(() => []);
          if (!groupMembers.length && groupFounder) {
            groupMembers = [groupFounder];
          }
        }

        const info: AssignmentInfo = {
          entry,
          org,
          classroom,
          status,
          repoUrl,
          releaseNotes,
          isGroupAssignment,
          maxGroupSize: entry.max_group_size,
          groupRepoUrl,
          groupFounder,
          groupMembers,
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

  // Save a classroom slug + optional display name under an org so it persists across reloads.
  async addClassroom(org: string, classroom: string, classroomName?: string): Promise<void> {
    const key = this.classroomStoreKey(org);
    const existing = this.readStoredClassrooms(org);
    const trimmedClassroom = classroom.trim();
    const trimmedName = classroomName?.trim();
    const existingIndex = existing.findIndex(
      (entry) => entry.slug.toLowerCase() === trimmedClassroom.toLowerCase()
    );

    if (existingIndex >= 0) {
      const current = existing[existingIndex];
      if (trimmedName && current.name !== trimmedName) {
        existing[existingIndex] = { ...current, name: trimmedName };
        await this.context.globalState.update(key, existing);
      }
      return;
    }

    await this.context.globalState.update(key, [...existing, { slug: trimmedClassroom, name: trimmedName }]);
  }

  async removeClassroom(org: string, classroom: string): Promise<void> {
    const key = this.classroomStoreKey(org);
    const existing = this.readStoredClassrooms(org);
    const remaining = existing.filter(
      (entry) => entry.slug.toLowerCase() !== classroom.trim().toLowerCase()
    );
    await this.context.globalState.update(key, remaining.length > 0 ? remaining : undefined);
  }

  private classroomStoreKey(org: string): string {
    return `classrooms:${org}`;
  }

  private readStoredClassrooms(org: string): StoredClassroom[] {
    const key = this.classroomStoreKey(org);
    const raw = this.context.globalState.get<unknown[]>(key) ?? [];
    const bySlug = new Map<string, StoredClassroom>();

    for (const entry of raw) {
      if (typeof entry === 'string') {
        const slug = entry.trim();
        if (!slug) {
          continue;
        }
        const id = slug.toLowerCase();
        if (!bySlug.has(id)) {
          bySlug.set(id, { slug });
        }
        continue;
      }

      if (typeof entry === 'object' && entry !== null && 'slug' in entry) {
        const slugValue = (entry as { slug?: unknown }).slug;
        const nameValue = (entry as { name?: unknown }).name;
        const slug = typeof slugValue === 'string' ? slugValue.trim() : '';
        const name = typeof nameValue === 'string' ? nameValue.trim() : undefined;
        if (!slug) {
          continue;
        }

        const id = slug.toLowerCase();
        const existing = bySlug.get(id);
        if (!existing) {
          bySlug.set(id, { slug, name });
        } else if (!existing.name && name) {
          bySlug.set(id, { ...existing, name });
        }
      }
    }

    return [...bySlug.values()];
  }
}
