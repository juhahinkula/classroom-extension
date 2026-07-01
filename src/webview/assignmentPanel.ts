import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { AssignmentInfo } from '../types';
import { getAssignmentWebviewContent } from './assignmentWebviewContent';

type WebviewMessage =
  | { type: 'accept' }
  | { type: 'openExternal'; url: string }
  | { type: 'copyCloneCommand'; command: string }
  | { type: 'cloneAndOpen' };

export class AssignmentPanel {
  private static readonly viewType = 'classroom50.assignment';
  private static panels = new Map<string, AssignmentPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private info: AssignmentInfo;

  private constructor(
    info: AssignmentInfo,
    private readonly onAccept: (info: AssignmentInfo) => Promise<void>
  ) {
    this.info = info;

    this.panel = vscode.window.createWebviewPanel(
      AssignmentPanel.viewType,
      info.entry.name || info.entry.slug,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.onDidDispose(
      () => this.dispose(),
      null,
      this.disposables
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.render();
  }

  static open(
    info: AssignmentInfo,
    onAccept: (info: AssignmentInfo) => Promise<void>
  ): AssignmentPanel {
    const key = `${info.org}/${info.classroom}/${info.entry.slug}`;
    const existing = AssignmentPanel.panels.get(key);

    if (existing) {
      existing.update(info);
      existing.panel.reveal(vscode.ViewColumn.One);
      return existing;
    }

    const panel = new AssignmentPanel(info, onAccept);
    AssignmentPanel.panels.set(key, panel);
    return panel;
  }

  update(info: AssignmentInfo): void {
    this.info = info;
    this.panel.title = info.entry.name || info.entry.slug;
    this.render();
  }

  notifyError(): void {
    this.panel.webview.postMessage({ type: 'acceptError' });
  }

  private render(): void {
    const nonce = createNonce();
    this.panel.webview.html = getAssignmentWebviewContent(
      this.panel.webview,
      this.info,
      nonce
    );
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'accept':
        await this.onAccept(this.info);
        break;
      case 'openExternal':
        await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      case 'copyCloneCommand':
        await vscode.env.clipboard.writeText(msg.command);
        await vscode.window.showInformationMessage('Clone command copied to clipboard');
        break;
      case 'cloneAndOpen': {
        const repoUrl = this.info.repoUrl;
        if (!repoUrl) {
          await vscode.window.showErrorMessage('Repository URL is not available for this assignment');
          break;
        }

        const cloneUrl = `${repoUrl.replace(/\/$/, '')}.git`;

        try {
          await vscode.commands.executeCommand('git.clone', cloneUrl);
        } catch {
          // Fallback for VS Code/Git extension versions with different clone argument handling.
          await vscode.commands.executeCommand('git.clone', cloneUrl);
        }
        break;
      }
    }
  }

  private dispose(): void {
    const key = `${this.info.org}/${this.info.classroom}/${this.info.entry.slug}`;
    AssignmentPanel.panels.delete(key);
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}

function createNonce(length = 32): string {
  return crypto.randomBytes(length).toString('base64url');
}
