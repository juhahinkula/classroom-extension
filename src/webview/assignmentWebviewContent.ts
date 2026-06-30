import * as vscode from 'vscode';
import { AssignmentInfo } from '../types';

export function getAssignmentWebviewContent(
  webview: vscode.Webview,
  info: AssignmentInfo,
  nonce: string
): string {
  const { entry, org, classroom, status, repoUrl } = info;
  const { releaseNotes } = info;
  const isAccepted = status === 'accepted' || status === 'submitted';
  const cloneCommand = repoUrl ? `git clone ${repoUrl.replace(/\/$/, '')}.git` : '';

  const acceptButton = isAccepted
    ? `<a class="btn btn-secondary" href="${repoUrl}" id="openBtn">Open Repository ↗</a>`
    : `<button class="btn btn-primary" id="acceptBtn">Accept Assignment</button>`;

  const statusBadge = status === 'submitted'
    ? `<span class="badge badge-success">✓ Submitted</span>`
    : isAccepted
    ? `<span class="badge badge-success">✓ Accepted</span>`
    : `<span class="badge badge-pending">Not yet accepted</span>`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${entry.name || entry.slug}</title>
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
      max-width: 640px;
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
    .clone-command {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .clone-command code {
      display: inline-block;
      padding: 10px 12px;
      border-radius: 6px;
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--border);
      white-space: nowrap;
      overflow-x: auto;
      max-width: 100%;
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
  </style>
</head>
<body>
  <h1>${escapeHtml(entry.name || entry.slug)}</h1>
  <div class="meta">${escapeHtml(org)} / ${escapeHtml(classroom)}</div>

  <div class="section">
    <div class="label">Status</div>
    <div class="value">${statusBadge}</div>
  </div>

  <div class="section">
    <div class="label">Assignment</div>
    <div class="value"><code>${escapeHtml(entry.slug)}</code></div>
  </div>

  ${repoUrl ? `<div class="section">
    <div class="label">Your repository</div>
    <div class="value"><a href="${repoUrl}" id="repoLink">${escapeHtml(repoUrl.replace('https://github.com/', ''))}</a></div>
  </div>` : ''}

  ${isAccepted && repoUrl ? `<div class="section">
    <div class="label">Clone</div>
    <div class="clone-command">
      <code id="cloneCommand">${escapeHtml(cloneCommand)}</code>
      <button class="btn btn-tertiary" id="copyCloneBtn">Copy</button>
    </div>
  </div>` : ''}

  ${repoUrl && releaseNotes ? `<div class="section release-notes">
    <div class="label">Grading</div>
    <pre class="release-body">${escapeHtml(releaseNotes)}</pre>
  </div>` : ''}

  <hr>

  <div>
    ${acceptButton}
    <p class="progress" id="progress">Accepting assignment, please wait…</p>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const acceptBtn = document.getElementById('acceptBtn');
    const openBtn   = document.getElementById('openBtn');
    const copyCloneBtn = document.getElementById('copyCloneBtn');
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
