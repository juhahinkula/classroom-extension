import { AssignmentEntry, AssignmentsFile, ASSIGNMENTS_SCHEMA_V1 } from '../types';

const CONFIG_REPO = 'classroom50';
const PAGES_FETCH_TIMEOUT_MS = 15_000;

// The Github Pages url to get assignments: https://{org}.github.io/classroom50/front-end-programming/assignments.json
export function pagesAssignmentsUrl(org: string, classroom: string): string {
  return `https://${org}.github.io/${CONFIG_REPO}/${classroom}/assignments.json`;
}

type ClassroomsIndexFile = {
  classrooms: {
    short_name: string;
    active?: boolean;
  }[];
};

// Fetch classrooms from Github pages
export async function fetchClassroomsFromPages(org: string): Promise<string[]> {
  const url = `https://${org}.github.io/${CONFIG_REPO}/classrooms-index.json`;
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

export async function fetchAssignments(
  org: string,
  classroom: string
): Promise<AssignmentEntry[]> {
  const url = pagesAssignmentsUrl(org, classroom);
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

  return file.assignments ?? [];
}

export async function fetchAutogradeShim(org: string): Promise<string> {
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
  return content.replaceAll(SHIM_ORG_PLACEHOLDER, org);
}
