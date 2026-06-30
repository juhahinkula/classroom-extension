export type TemplateRef = {
  owner: string;
  repo: string;
  branch: string;
};

export type AssignmentEntry = {
  slug: string;
  name: string;
  mode: string;
  template: TemplateRef;
  autograder: string;
};

export type AssignmentsFile = {
  schema: string;
  assignments: AssignmentEntry[];
};

export const ASSIGNMENTS_SCHEMA_V1 = 'classroom50/assignments/v1';

export type ClassroomSource = {
  owner: string;
  repo: string;
  branch: string;
};

export type ClassroomConfig = {
  classroom: string;
  assignment: string;
  source: ClassroomSource;
};

export type GitHubUser = {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
};

export type GitHubOrg = {
  login: string;
  id: number;
  description: string | null;
};

export type GitHubRepo = {
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  owner: { login: string };
};

export type ClassroomInfo = {
  org: string;
  slug: string;
};

export type AssignmentStatus = 'pending' | 'accepted' | 'submitted';

export type AssignmentInfo = {
  entry: AssignmentEntry;
  org: string;
  classroom: string;
  status: AssignmentStatus;
  repoUrl?: string;
  releaseNotes?: string;
};
