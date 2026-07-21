import * as assert from 'assert';
import * as vscode from 'vscode';
import { getAssignmentWebviewContent } from '../webview/assignmentWebviewContent';
import { AssignmentEntry, AssignmentInfo } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockWebview = {
  cspSource: 'https://mock.vscode-cdn.net',
} as vscode.Webview;

const NONCE = 'test-nonce-1234';

function makeEntry(overrides?: Partial<AssignmentEntry>): AssignmentEntry {
  return {
    slug: 'pset1',
    name: 'Problem Set 1',
    mode: 'individual',
    template: { owner: 'cs50', repo: 'pset1-template', branch: 'main' },
    autograder: 'default',
    ...overrides,
  };
}

function makeInfo(overrides?: Partial<AssignmentInfo>): AssignmentInfo {
  return {
    entry: makeEntry(),
    org: 'cs50',
    classroom: 'fall-2026',
    status: 'pending',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Status badge rendering
// ---------------------------------------------------------------------------

suite('getAssignmentWebviewContent – status badge', () => {
  test('shows "Not yet accepted" badge for pending assignments', () => {
    const html = getAssignmentWebviewContent(mockWebview, makeInfo({ status: 'pending' }), NONCE);
    assert.ok(html.includes('Not yet accepted'), 'Expected pending badge text');
  });

  test('shows "Accepted" badge for accepted assignments', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ status: 'accepted', repoUrl: 'https://github.com/cs50/pset1-alice' }),
      NONCE
    );
    assert.ok(html.includes('Accepted'), 'Expected accepted badge text');
  });

  test('shows "Submitted" badge for submitted assignments', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({
        status: 'submitted',
        repoUrl: 'https://github.com/cs50/pset1-alice',
        releaseNotes: 'Score: 90/100',
      }),
      NONCE
    );
    assert.ok(html.includes('Submitted'), 'Expected submitted badge text');
  });
});

// ---------------------------------------------------------------------------
// Accept / open button rendering
// ---------------------------------------------------------------------------

suite('getAssignmentWebviewContent – action buttons', () => {
  test('shows Accept Assignment button for pending assignments', () => {
    const html = getAssignmentWebviewContent(mockWebview, makeInfo({ status: 'pending' }), NONCE);
    assert.ok(html.includes('acceptBtn'), 'Expected accept button');
  });

  test('does not show Accept button for accepted assignments', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ status: 'accepted', repoUrl: 'https://github.com/cs50/pset1-alice' }),
      NONCE
    );
    assert.ok(!html.includes('id="acceptBtn"'), 'Did not expect accept button for accepted assignment');
  });

  test('does not show Accept button for submitted assignments', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({
        status: 'submitted',
        repoUrl: 'https://github.com/cs50/pset1-alice',
        releaseNotes: 'Score: 90/100',
      }),
      NONCE
    );
    assert.ok(!html.includes('id="acceptBtn"'), 'Did not expect accept button for submitted assignment');
  });

  test('shows open repository link for accepted assignments', () => {
    const repoUrl = 'https://github.com/cs50/pset1-alice';
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ status: 'accepted', repoUrl }),
      NONCE
    );
    assert.ok(html.includes('openBtn'), 'Expected open button for accepted assignment');
  });
});

// ---------------------------------------------------------------------------
// Clone section
// ---------------------------------------------------------------------------

suite('getAssignmentWebviewContent – clone section', () => {
  test('shows clone section for accepted assignments with repo URL', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ status: 'accepted', repoUrl: 'https://github.com/cs50/pset1-alice' }),
      NONCE
    );
    assert.ok(html.includes('cloneCommand'), 'Expected clone command element');
    assert.ok(html.includes('git clone'), 'Expected git clone command in output');
  });

  test('does not show clone section for pending assignments', () => {
    const html = getAssignmentWebviewContent(mockWebview, makeInfo({ status: 'pending' }), NONCE);
    assert.ok(!html.includes('cloneCommand'), 'Did not expect clone section for pending assignment');
  });

  test('does not show clone section for submitted assignments', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({
        status: 'submitted',
        repoUrl: 'https://github.com/cs50/pset1-alice',
        releaseNotes: 'Score: 90/100',
      }),
      NONCE
    );
    assert.ok(!html.includes('cloneCommand'), 'Did not expect clone section for submitted assignment');
  });

  test('clone command contains the .git suffix', () => {
    const repoUrl = 'https://github.com/cs50/pset1-alice';
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ status: 'accepted', repoUrl }),
      NONCE
    );
    assert.ok(html.includes(`${repoUrl}.git`), 'Expected .git suffix on clone URL');
  });
});

// ---------------------------------------------------------------------------
// Repository link
// ---------------------------------------------------------------------------

suite('getAssignmentWebviewContent – repo link', () => {
  test('shows repository URL section when repoUrl is provided', () => {
    const repoUrl = 'https://github.com/cs50/pset1-alice';
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ status: 'accepted', repoUrl }),
      NONCE
    );
    assert.ok(html.includes(repoUrl), 'Expected repo URL in output');
  });

  test('does not show repository section when repoUrl is absent', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ status: 'pending', repoUrl: undefined }),
      NONCE
    );
    assert.ok(!html.includes('Your repository'), 'Did not expect repo section without URL');
  });
});

// ---------------------------------------------------------------------------
// Release notes / grading
// ---------------------------------------------------------------------------

suite('getAssignmentWebviewContent – release notes', () => {
  test('shows grading section when both repoUrl and releaseNotes are present', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({
        status: 'submitted',
        repoUrl: 'https://github.com/cs50/pset1-alice',
        releaseNotes: 'Score: 95/100',
      }),
      NONCE
    );
    assert.ok(html.includes('Score: 95/100'), 'Expected release notes in output');
    assert.ok(html.includes('Grading'), 'Expected grading section label');
  });

  test('does not show grading section when releaseNotes is absent', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({
        status: 'accepted',
        repoUrl: 'https://github.com/cs50/pset1-alice',
        releaseNotes: undefined,
      }),
      NONCE
    );
    assert.ok(!html.includes('release-body'), 'Did not expect grading section without release notes');
  });

  test('does not show grading section when repoUrl is absent', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ status: 'pending', releaseNotes: 'Score: 80/100' }),
      NONCE
    );
    assert.ok(!html.includes('Score: 80/100'), 'Did not expect release notes without repo URL');
  });
});

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

suite('getAssignmentWebviewContent – HTML escaping', () => {
  test('escapes < and > in assignment name', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ entry: makeEntry({ name: '<script>alert(1)</script>' }) }),
      NONCE
    );
    assert.ok(html.includes('&lt;script&gt;'), 'Expected escaped < and >');
    assert.ok(!html.includes('<script>alert(1)</script>'), 'Raw script tag must not appear');
  });

  test('escapes & in org name', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ org: 'cs50 & friends' }),
      NONCE
    );
    assert.ok(html.includes('cs50 &amp; friends'), 'Expected escaped &');
  });

  test('escapes " in assignment slug', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ entry: makeEntry({ slug: 'say-"hello"' }) }),
      NONCE
    );
    assert.ok(html.includes('&quot;'), 'Expected escaped double-quote');
    assert.ok(!html.includes('say-"hello"'), 'Raw double-quote must not appear in code element');
  });

  test('uses slug as title when name is empty', () => {
    const html = getAssignmentWebviewContent(
      mockWebview,
      makeInfo({ entry: makeEntry({ name: '', slug: 'hw-01' }) }),
      NONCE
    );
    assert.ok(html.includes('hw-01'), 'Expected slug to be used as title');
  });

  test('CSP nonce is included in script tag', () => {
    const html = getAssignmentWebviewContent(mockWebview, makeInfo(), NONCE);
    assert.ok(html.includes(`nonce="${NONCE}"`), 'Expected nonce in script tag');
  });
});
