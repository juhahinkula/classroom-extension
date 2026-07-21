import * as vscode from 'vscode';
import { AssignmentInfo } from '../types';

export function getAssignmentWebviewContent(
  webview: vscode.Webview,
  info: AssignmentInfo,
  nonce: string
): string {
  const { entry, org, classroom, status, repoUrl } = info;
  const { releaseNotes, isGroupAssignment, maxGroupSize, groupMembers, groupRepoUrl } = info;
  const isAccepted = status === 'accepted' || status === 'submitted';
  const isGroupMember = status === 'group-member';
  const isGroupFull = Boolean(
    isGroupAssignment &&
      typeof maxGroupSize === 'number' &&
      maxGroupSize > 0 &&
      Array.isArray(groupMembers) &&
      groupMembers.length >= maxGroupSize
  );
  const headerTitle = entry.name && entry.name !== entry.slug
    ? `${entry.name} (${entry.slug})`
    : entry.slug;
  const canManageCollaborators = Boolean(
    isGroupAssignment && isAccepted && !isGroupMember && repoUrl && !isGroupFull
  );
  const openRepoUrl = isGroupMember ? (groupRepoUrl || repoUrl) : repoUrl;
  const cloneCommand = repoUrl ? `git clone ${repoUrl.replace(/\/$/, '')}.git` : '';

  const acceptButton = (isAccepted || isGroupMember) && openRepoUrl
    ? `<a class="btn btn-secondary" href="${openRepoUrl}" id="openBtn">${isGroupMember ? 'Open Group Repository ↗' : 'Open Repository ↗'}</a>`
    : `<button class="btn btn-primary" id="acceptBtn">Accept Assignment</button>`;

  const statusBadge = status === 'submitted'
    ? `<span class="badge badge-success">✓ Submitted</span>`
    : status === 'group-member'
    ? `<span class="badge badge-success">Already in group</span>`
    : isAccepted
    ? `<span class="badge badge-success">✓ Accepted</span>`
    : `<span class="badge badge-pending">Not yet accepted</span>`;

  const modeBadge = isGroupAssignment
    ? `<span class="badge badge-pending">Group${maxGroupSize ? ` (max ${maxGroupSize})` : ''}</span>`
    : `<span class="badge badge-pending">Individual</span>`;

  const groupMembersHtml = groupMembers && groupMembers.length
    ? `<div class="section">
    <div class="label">Group members</div>
    <div class="value"><code>${groupMembers.map((member) => escapeHtml(member)).join('</code>, <code>')}</code></div>
  </div>`
    : '';

  const groupDetailsUnderModeHtml = isGroupAssignment
    ? `<div class="section">
    <div class="label">Group members</div>
    <div class="group-members-row">
      <div class="value group-members-value">${groupMembers && groupMembers.length
      ? `<code>${groupMembers.map((member) => escapeHtml(member)).join('</code>, <code>')}</code>`
      : '<span>Not available yet</span>'}</div>
      ${(canManageCollaborators || isGroupFull)
      ? `<button class="btn btn-manage" id="manageCollaboratorsBtn" ${isGroupFull ? 'disabled aria-disabled="true" title="Group is full"' : ''}>Manage Collaborators</button>`
      : ''}
    </div>
    ${isGroupFull ? '<div class="group-full-warning">Group is full. Maximum group size reached.</div>' : ''}
  </div>`
    : '';

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headerTitle}</title>
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --input-bg: var(--vscode-input-background);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --link: var(--vscode-textLink-foreground);
      --success: var(--vscode-testing-iconPassed);
      --font: var(--vscode-font-family);
      --font-size: var(--vscode-font-size);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--font);
      font-size: var(--font-size);
      padding: 24px;
      max-width: 920px;
    }
    h1 { font-size: 1.4em; margin-bottom: 8px; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 20px; }
    .section { margin-bottom: 20px; }
    .label { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.05em;
              color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    .value a { color: var(--link); text-decoration: none; }
    .value a:hover { text-decoration: underline; }
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 10px;
      font-size: 0.8em; font-weight: 600;
    }
    .badge-success { background: var(--vscode-testing-iconPassed); color: #fff; }
    .badge-pending { background: var(--vscode-activityBarBadge-background);
                     color: var(--vscode-activityBarBadge-foreground); }
    .btn {
      display: inline-block; padding: 8px 18px; border-radius: 4px; font-size: 1em;
      cursor: pointer; border: none; text-decoration: none;
    }
    .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
    .btn-primary:hover:not(:disabled) { background: var(--btn-hover); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: transparent; color: var(--link); border: 1px solid var(--border); }
    .btn-secondary:hover { text-decoration: underline; }
    .btn-tertiary {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
    }
    .btn-tertiary:hover { background: var(--vscode-toolbar-hoverBackground); }
    .btn-clone-open {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: 1px solid transparent;
    }
    .btn-clone-open:hover { background: var(--btn-hover); }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .group-members-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .group-members-value {
      flex: 1 1 auto;
      min-width: 0;
    }
    .btn-manage {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: 1px solid transparent;
      white-space: nowrap;
    }
    .btn-manage:hover { background: var(--btn-hover); }
    .btn-manage:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .group-full-warning {
      margin-top: 6px;
      color: var(--vscode-editorWarning-foreground);
      font-size: 0.9em;
    }
    .clone-command {
      display: block;
      margin-top: 8px;
    }
    .clone-command code {
      display: block;
      padding: 10px 12px;
      border-radius: 6px;
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--border);
      width: 100%;
      white-space: nowrap;
      overflow-x: auto;
      max-width: 100%;
      margin-bottom: 10px;
    }
    .progress { display: none; font-style: italic; color: var(--vscode-descriptionForeground); margin-top: 8px; }
    hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
    .release-notes { margin-top: 8px; }
    .note-hint { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-bottom: 8px; }
    .release-body {
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      color: var(--fg);
      max-height: 360px;
      overflow: auto;
    }
    .info-box {
      border: 1px solid var(--border);
      border-left: 4px solid var(--btn-bg);
      border-radius: 6px;
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
    }
    .info-title {
      font-weight: 600;
      margin-bottom: 8px;
    }
    .info-list {
      margin-left: 18px;
      line-height: 1.5;
    }
    .info-list code {
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1px 5px;
    }
    .info-note {
      margin-top: 10px;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(headerTitle)}</h1>
  <div class="meta">${escapeHtml(org)} / ${escapeHtml(classroom)}</div>

  <div class="section">
    <div class="label">Status</div>
    <div class="value">${statusBadge}</div>
  </div>

  <div class="section">
    <div class="label">Mode</div>
    <div class="value">${modeBadge}</div>
  </div>

  ${groupDetailsUnderModeHtml}

  ${openRepoUrl ? `<div class="section">
    <div class="label">${isGroupMember ? 'Group repository' : 'Your repository'}</div>
    <div class="value"><a href="${openRepoUrl}" id="repoLink">${escapeHtml(openRepoUrl.replace('https://github.com/', ''))}</a></div>
  </div>` : ''}

  ${!isGroupAssignment ? groupMembersHtml : ''}

  ${status === 'accepted' && repoUrl ? `<div class="section">
    <div class="label">Clone</div>
    <div class="clone-command">
      <code id="cloneCommand">${escapeHtml(cloneCommand)}</code>
      <button class="btn btn-tertiary" id="copyCloneBtn">Copy</button>
      <button class="btn btn-clone-open" id="cloneOpenBtn">Clone & Open</button>
    </div>
  </div>` : ''}

  ${status === 'accepted' ? `<div class="section info-box">
    <div class="info-title">How to submit</div>
    <ol class="info-list">
      <li>Make your code changes locally.</li>
      <li>Commit your work: <code>git commit -m "Your message"</code></li>
      <li>Push to GitHub: <code>git push</code></li>
    </ol>
    <p class="info-note">After push, status may take a while to change to Submitted because Classroom50 uses GitHub workflows for grading.</p>
  </div>` : ''}

  ${status === 'group-member' ? `<div class="section info-box">
    <div class="info-title">Already in a group</div>
    <p class="info-note">You already belong to a group repository for this assignment. Ask your group admin to manage collaborators if your team needs changes.</p>
  </div>` : ''}

  ${repoUrl && releaseNotes ? `<div class="section release-notes">
    <div class="label">Grading</div>
    <pre class="release-body">${escapeHtml(releaseNotes)}</pre>
  </div>` : ''}

  <hr>

  <div class="actions">
    ${acceptButton}
    <p class="progress" id="progress">Accepting assignment, please wait…</p>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const acceptBtn = document.getElementById('acceptBtn');
    const openBtn   = document.getElementById('openBtn');
    const copyCloneBtn = document.getElementById('copyCloneBtn');
    const cloneOpenBtn = document.getElementById('cloneOpenBtn');
    const manageCollaboratorsBtn = document.getElementById('manageCollaboratorsBtn');
    const cloneCommandEl = document.getElementById('cloneCommand');
    const progress  = document.getElementById('progress');

    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => {
        acceptBtn.disabled = true;
        progress.style.display = 'block';
        vscode.postMessage({ type: 'accept' });
      });
    }

    if (copyCloneBtn && cloneCommandEl) {
      copyCloneBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'copyCloneCommand',
          command: cloneCommandEl.textContent || '',
        });
      });
    }

    if (cloneOpenBtn) {
      cloneOpenBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'cloneAndOpen',
        });
      });
    }

    if (manageCollaboratorsBtn) {
      manageCollaboratorsBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'openManageCollaborators',
        });
      });
    }

    // Open external links via the extension host
    document.querySelectorAll('a[href^="https://"]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        vscode.postMessage({ type: 'openExternal', url: a.getAttribute('href') });
      });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'acceptError') {
        if (acceptBtn) {
          acceptBtn.disabled = false;
          progress.style.display = 'none';
        }
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
