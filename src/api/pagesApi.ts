import { AssignmentEntry, AssignmentsFile, ASSIGNMENTS_SCHEMA_V1, TemplateRef } from '../types';

const CONFIG_REPO = 'classroom50';
const PAGES_FETCH_TIMEOUT_MS = 15_000;
const ACCESS_KEY_PATTERN = /^[a-z0-9]{4,64}$/;

function classroomPagesSegment(classroom: string, accessKey?: string): string {
  return accessKey
    ? `${classroom}/${encodeURIComponent(accessKey)}`
    : classroom;
}

export function isValidAccessKey(value: string): boolean {
  return ACCESS_KEY_PATTERN.test(value);
}

// The Github Pages url to get assignments: https://{org}.github.io/classroom50/front-end-programming/assignments.json
// Key is added for unlisted classrooms
export function pagesAssignmentsUrl(
  org: string,
  classroom: string,
  accessKey?: string
): string {
  return `https://${org}.github.io/${CONFIG_REPO}/${classroomPagesSegment(classroom, accessKey)}/assignments.json`;
}

export function pagesAutograderUrl(
  org: string,
  classroom: string,
  autograderName: string,
  accessKey?: string
): string {
  return `https://${org}.github.io/${CONFIG_REPO}/${classroomPagesSegment(classroom, accessKey)}/autograders/${encodeURIComponent(autograderName)}.yaml`;
}

type ClassroomsIndexFile = {
  classrooms: {
    short_name: string;
    active?: boolean;
  }[];
};

export type OrgPagesVerdict = 'yes' | 'no' | 'indeterminate';

export function classroomsIndexUrl(org: string): string {
  return `https://${org}.github.io/${CONFIG_REPO}/classrooms-index.json`;
}

// Check if organization is potential Classroom50 organization
// It will check Github pages if classrooms-index.json exists
// Intermediate is uncertain and will be shown
export async function orgPublishesClassroomPages(org: string): Promise<OrgPagesVerdict> {
  const url = classroomsIndexUrl(org);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal: controller.signal });
  } catch {
    return 'indeterminate';
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) {
    return 'no';
  }
  if (!response.ok) {
    return 'indeterminate';
  }

  try {
    const data = (await response.json()) as { classrooms?: unknown };
    return Array.isArray(data.classrooms) ? 'yes' : 'no';
  } catch {
    return 'indeterminate';
  }
}

// Fetch classrooms from Github pages
export async function fetchClassroomsFromPages(org: string): Promise<string[]> {
  const url = classroomsIndexUrl(org);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGES_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return [];
  }

  const file = (await response.json()) as ClassroomsIndexFile;
  return (file.classrooms ?? [])
    .filter((classroom) => classroom.active !== false)
    .map((classroom) => classroom.short_name)
    .filter(Boolean);
}

// TODO: Is this ok??
export const AUTOGRADE_SHIM_URL =
  'https://raw.githubusercontent.com/foundation50/classroom50/main/cli/gh-student/embed/autograde-shim.yaml';

export const SHIM_ORG_PLACEHOLDER = '{{ORG}}';
export const SHIM_BRANCH_PLACEHOLDER = '{{BRANCH}}';
export const SHIM_CONFIG_BRANCH_PLACEHOLDER = '{{CONFIG_BRANCH}}';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : undefined;
}

function normalizeTemplateRef(raw: Record<string, unknown>): TemplateRef {
  const templateCandidate = isRecord(raw.template)
    ? raw.template
    : isRecord(raw.source)
    ? raw.source
    : undefined;

  if (!templateCandidate) {
    return { owner: '', repo: '', branch: '' };
  }

  return {
    owner: readString(templateCandidate, 'owner') || '',
    repo: readString(templateCandidate, 'repo') || '',
    branch: readString(templateCandidate, 'branch') || '',
  };
}

function normalizeAssignmentEntry(raw: unknown): AssignmentEntry | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const slug = readString(raw, 'slug');
  if (!slug) {
    return undefined;
  }

  const maxGroupSizeRaw = raw.max_group_size;
  const maxGroupSize = typeof maxGroupSizeRaw === 'number' ? maxGroupSizeRaw : undefined;

  return {
    slug,
    name: readString(raw, 'name') || slug,
    mode: readString(raw, 'mode') || 'individual',
    max_group_size: maxGroupSize,
    template: normalizeTemplateRef(raw),
    autograder: readString(raw, 'autograder') || 'default',
  };
}

export async function fetchAssignments(
  org: string,
  classroom: string,
  accessKey?: string
): Promise<AssignmentEntry[]> {
  const url = pagesAssignmentsUrl(org, classroom, accessKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGES_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach ${url}: ${msg}. The classroom may not exist yet.`
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) {
    throw new Error(
      `${url} returned 404 — the classroom may not exist yet.`
    );
  }
  if (!response.ok) {
    throw new Error(`GET ${url}: unexpected status ${response.status}`);
  }

  const file = (await response.json()) as AssignmentsFile;
  if (file.schema !== ASSIGNMENTS_SCHEMA_V1) {
    throw new Error(
      `${url}: schema = "${file.schema}", want "${ASSIGNMENTS_SCHEMA_V1}" — update the Classroom50 extension.`
    );
  }

  return (file.assignments ?? [])
    .map((entry) => normalizeAssignmentEntry(entry))
    .filter((entry): entry is AssignmentEntry => Boolean(entry));
}

export async function fetchAutogradeShim(
  org: string,
  branch: string,
  configBranch: string
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGES_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(AUTOGRADE_SHIM_URL, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `Could not fetch autograde shim (status ${response.status}). Check your internet connection.`
    );
  }

  const content = await response.text();
  return content
    .replaceAll(SHIM_ORG_PLACEHOLDER, org)
    .replaceAll(SHIM_BRANCH_PLACEHOLDER, branch)
    .replaceAll(SHIM_CONFIG_BRANCH_PLACEHOLDER, configBranch);
}

export async function fetchAutograderByName(
  org: string,
  classroom: string,
  autograderName: string,
  accessKey?: string
): Promise<string> {
  const url = pagesAutograderUrl(org, classroom, autograderName, accessKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGES_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach ${url}: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) {
    throw new Error(
      `Autograder "${autograderName}" is not published yet. Ask your instructor to verify autograders/${autograderName}.yaml and run publish-pages.`
    );
  }
  if (!response.ok) {
    throw new Error(`GET ${url}: unexpected status ${response.status}`);
  }

  const workflow = await response.text();
  if (!workflow.trim()) {
    throw new Error(
      `Autograder "${autograderName}" is empty. Pages deployment may still be in flight. Retry in a minute.`
    );
  }
  if (!workflow.includes('jobs:')) {
    throw new Error(
      `Autograder "${autograderName}" appears malformed YAML. Ask your instructor to verify the file.`
    );
  }

  return workflow;
}

export async function resolveAutogradeWorkflow(
  org: string,
  classroom: string,
  autograderName: string | undefined,
  accessKey?: string,
  branch: string = 'main',
  configBranch: string = 'main'
): Promise<string> {
  const name = autograderName?.trim();
  if (!name || name === 'default') {
    return fetchAutogradeShim(org, branch, configBranch);
  }
  return fetchAutograderByName(org, classroom, name, accessKey);
}
