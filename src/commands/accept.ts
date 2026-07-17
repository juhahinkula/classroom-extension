/*
  Student accept an assignment
  This do the same operations than `gh student accept` cli command
  For more information: https://github.com/foundation50/classroom50/wiki/gh-student
*/
import * as vscode from 'vscode';
import { requireGitHubSession } from '../auth/authProvider';
import {
  getUser,
  getOrgMembership,
  acceptOrgInvite,
  assignmentRepoName,
  createRepoFromTemplate,
  getRepoDefaultBranch,
  patchRepo,
  addCollaborator,
  waitForStableBranch,
  commitFiles,
  renderClassroomMetadata,
} from '../api/classroomApi';
import { fetchAssignments, isValidAccessKey, resolveAutogradeWorkflow } from '../api/pagesApi';
import { AssignmentInfo, ClassroomConfig } from '../types';

const CLASSROOM_METADATA_PATH = '.classroom50.yaml';
const AUTOGRADE_WORKFLOW_PATH = '.github/workflows/autograde.yaml';

function isPagesNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return err.message.includes('returned 404');
}

async function promptForAccessKey(org: string, classroom: string): Promise<string | undefined> {
  const key = await vscode.window.showInputBox({
    title: 'Classroom Access Key Required',
    prompt: `The classroom ${org}/${classroom} may be protected. Paste the access key from your invitation link (?k=...).`,
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

function classroomAccessKeyStoreKey(org: string, classroom: string): string {
  return `classroom-access-key:${org.toLowerCase()}/${classroom.toLowerCase()}`;
}

export async function acceptAssignment(
  info: AssignmentInfo,
  state: vscode.Memento
): Promise<string | undefined> {
  const { entry, org, classroom } = info;

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Accepting assignment "${entry.name || entry.slug}"`,
      cancellable: false,
    },
    async (progress) => {
      const session = await requireGitHubSession();
      const token = session.accessToken;

      // get the authenticated user
      progress.report({ message: 'Checking GitHub identity…', increment: 5 });
      const user = await getUser(token);
      const login = user.login;

      // check and accept pending org invite
      progress.report({ message: 'Checking org membership…', increment: 10 });
      const membership = await getOrgMembership(token, org);
      if (!membership) {
        throw new Error(
          `No membership found for org "${org}". Make sure your instructor has invited you.`
        );
      }
      if (membership.state === 'pending') {
        progress.report({ message: 'Accepting org invitation…', increment: 5 });
        await acceptOrgInvite(token, org);
      }

      // fetch assignments.json and confirm the slug exists
      progress.report({ message: 'Looking up assignment…', increment: 10 });
      const accessKeyStorageKey = classroomAccessKeyStoreKey(org, classroom);
      const savedAccessKey = state.get<string>(accessKeyStorageKey);
      let activeAccessKey = savedAccessKey;
      let assignments;
      try {
        assignments = await fetchAssignments(org, classroom, activeAccessKey);
      } catch (err) {
        if (!isPagesNotFoundError(err)) {
          throw err;
        }

        const accessKey = await promptForAccessKey(org, classroom);
        if (!accessKey) {
          return undefined;
        }

        progress.report({ message: 'Retrying with classroom access key…', increment: 5 });
        try {
          assignments = await fetchAssignments(org, classroom, accessKey);
          activeAccessKey = accessKey;
          await state.update(accessKeyStorageKey, accessKey);
        } catch {
          throw new Error(
            `Could not access ${org}/${classroom} with that access key. Re-open your invitation link and copy the value after ?k=.`
          );
        }
      }

      const matched = assignments.find((a) => a.slug === entry.slug);
      if (!matched) {
        throw new Error(
          `Assignment "${entry.slug}" is not registered in ${org}/${classroom}. Contact your teacher.`
        );
      }
      if (matched.mode && matched.mode !== '' && matched.mode !== 'individual') {
        throw new Error(`Assignment "${entry.slug}" is mode "${matched.mode}" — group assignments are not yet supported.`);
      }
      const tmpl = matched.template;
      if (!tmpl.owner || !tmpl.repo || !tmpl.branch) {
        throw new Error(
          `Assignment "${entry.slug}" has an incomplete template ref. Contact your teacher.`
        );
      }

      // create private repo from template
      const repoName = assignmentRepoName(classroom, entry.slug, login);
      progress.report({ message: `Creating repository ${org}/${repoName}…`, increment: 20 });
      const { repo, alreadyExists } = await createRepoFromTemplate(
        token,
        tmpl.owner,
        tmpl.repo,
        org,
        repoName
      );

      if (alreadyExists) {
        vscode.window.showInformationMessage(
          `Assignment already accepted: ${repo.full_name}`,
          'Open on GitHub'
        ).then((choice) => {
          if (choice === 'Open on GitHub') {
            vscode.env.openExternal(vscode.Uri.parse(repo.html_url));
          }
        });
        return repo.html_url;
      }

      progress.report({ message: 'Configuring repository…', increment: 10 });
      await patchRepo(token, org, repoName, {
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      });

      // add student as maintain collaborator
      progress.report({ message: 'Adding you as collaborator…', increment: 10 });
      await addCollaborator(token, org, repoName, login, 'maintain');

      // Resolve the branch after repo creation so default shim trigger matches
      // the assignment repo's real default branch.
      const targetBranch = repo.default_branch || tmpl.branch;
      const configBranch =
        (await getRepoDefaultBranch(token, org, 'classroom50').catch(() => undefined)) ||
        targetBranch;

      progress.report({ message: 'Resolving autograde workflow…', increment: 10 });
      const shim = await resolveAutogradeWorkflow(
        org,
        classroom,
        matched.autograder,
        activeAccessKey,
        targetBranch,
        configBranch
      );

      progress.report({ message: 'Waiting for repository to initialise…', increment: 10 });
      await waitForStableBranch(token, org, repoName, targetBranch);

      progress.report({ message: 'Writing classroom metadata and autograde workflow…', increment: 10 });
      const cfg: ClassroomConfig = {
        classroom,
        assignment: entry.slug,
        source: { owner: tmpl.owner, repo: tmpl.repo, branch: tmpl.branch },
      };
      await commitFiles(
        token,
        org,
        repoName,
        targetBranch,
        'Initialize .classroom50.yaml and autograde workflow (classroom50 extension)',
        {
          [CLASSROOM_METADATA_PATH]: renderClassroomMetadata(cfg),
          [AUTOGRADE_WORKFLOW_PATH]: shim,
        }
      );

      progress.report({ message: 'Done!', increment: 10 });

      const choice = await vscode.window.showInformationMessage(
        `Assignment accepted: ${repo.full_name}\n\nClone with: git clone ${repo.html_url}.git`,
        'Open on GitHub',
        'Copy Clone URL'
      );
      if (choice === 'Open on GitHub') {
        await vscode.env.openExternal(vscode.Uri.parse(repo.html_url));
      } else if (choice === 'Copy Clone URL') {
        await vscode.env.clipboard.writeText(`git clone ${repo.html_url}.git`);
      }

      return repo.html_url;
    }
  );
}
