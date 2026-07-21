import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  OrgItem,
  ClassroomItem,
  AssignmentItem,
  MessageItem,
  ActionItem,
  ClassroomTreeProvider,
} from '../providers/classroomTreeProvider';
import { AssignmentEntry, AssignmentInfo } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/**
 * Minimal in-memory Memento for tests that don't need persistence across
 * sessions.
 */
class MemoryMemento implements vscode.Memento {
  private store = new Map<string, unknown>();

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get(key: string, defaultValue?: unknown): unknown {
    return this.store.has(key) ? this.store.get(key) : defaultValue;
  }

  update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, value);
    }
    return Promise.resolve();
  }

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  setKeysForSync(_keys: readonly string[]): void {}
}

function makeProvider(): ClassroomTreeProvider {
  const context = {
    globalState: new MemoryMemento(),
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
  return new ClassroomTreeProvider(context);
}

// ---------------------------------------------------------------------------
// OrgItem
// ---------------------------------------------------------------------------

suite('OrgItem', () => {
  test('label equals the org name', () => {
    const item = new OrgItem('cs50');
    assert.strictEqual(item.label, 'cs50');
  });

  test('contextValue is "org"', () => {
    const item = new OrgItem('cs50');
    assert.strictEqual(item.contextValue, 'org');
  });

  test('kind property is "org"', () => {
    const item = new OrgItem('myorg');
    assert.strictEqual(item.kind, 'org');
  });

  test('collapsible state is Collapsed', () => {
    const item = new OrgItem('cs50');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  });
});

// ---------------------------------------------------------------------------
// ClassroomItem
// ---------------------------------------------------------------------------

suite('ClassroomItem', () => {
  test('label equals the classroom name', () => {
    const item = new ClassroomItem('cs50', 'fall-2026');
    assert.strictEqual(item.label, 'fall-2026');
  });

  test('contextValue is "classroom"', () => {
    const item = new ClassroomItem('cs50', 'fall-2026');
    assert.strictEqual(item.contextValue, 'classroom');
  });

  test('exposes org and classroom properties', () => {
    const item = new ClassroomItem('cs50', 'fall-2026');
    assert.strictEqual(item.org, 'cs50');
    assert.strictEqual(item.classroom, 'fall-2026');
  });

  test('kind property is "classroom"', () => {
    const item = new ClassroomItem('cs50', 'fall-2026');
    assert.strictEqual(item.kind, 'classroom');
  });
});

// ---------------------------------------------------------------------------
// AssignmentItem
// ---------------------------------------------------------------------------

suite('AssignmentItem – pending', () => {
  test('contextValue is "assignment-pending"', () => {
    const item = new AssignmentItem(makeInfo({ status: 'pending' }));
    assert.strictEqual(item.contextValue, 'assignment-pending');
  });

  test('description is "not accepted"', () => {
    const item = new AssignmentItem(makeInfo({ status: 'pending' }));
    assert.ok(
      String(item.description).includes('not accepted'),
      `Unexpected description: ${item.description}`
    );
  });
});

suite('AssignmentItem – accepted', () => {
  test('contextValue is "assignment-accepted"', () => {
    const item = new AssignmentItem(
      makeInfo({ status: 'accepted', repoUrl: 'https://github.com/cs50/pset1-alice' })
    );
    assert.strictEqual(item.contextValue, 'assignment-accepted');
  });

  test('description includes "accepted"', () => {
    const item = new AssignmentItem(
      makeInfo({ status: 'accepted', repoUrl: 'https://github.com/cs50/pset1-alice' })
    );
    assert.ok(
      String(item.description).includes('accepted'),
      `Unexpected description: ${item.description}`
    );
  });
});

suite('AssignmentItem – submitted', () => {
  test('contextValue is "assignment-submitted"', () => {
    const item = new AssignmentItem(
      makeInfo({
        status: 'submitted',
        repoUrl: 'https://github.com/cs50/pset1-alice',
        releaseNotes: 'Score: 90/100',
      })
    );
    assert.strictEqual(item.contextValue, 'assignment-submitted');
  });

  test('description includes "submitted"', () => {
    const item = new AssignmentItem(
      makeInfo({ status: 'submitted', repoUrl: 'https://github.com/cs50/pset1-alice', releaseNotes: 'ok' })
    );
    assert.ok(
      String(item.description).includes('submitted'),
      `Unexpected description: ${item.description}`
    );
  });
});

suite('AssignmentItem – label', () => {
  test('uses entry name as label when present', () => {
    const item = new AssignmentItem(makeInfo({ entry: makeEntry({ name: 'Problem Set 1', slug: 'pset1' }) }));
    assert.strictEqual(item.label, 'Problem Set 1');
  });

  test('falls back to slug when name is empty', () => {
    const item = new AssignmentItem(makeInfo({ entry: makeEntry({ name: '', slug: 'pset1' }) }));
    assert.strictEqual(item.label, 'pset1');
  });

  test('exposes assignmentInfo property', () => {
    const info = makeInfo();
    const item = new AssignmentItem(info);
    assert.strictEqual(item.assignmentInfo, info);
  });
});

// ---------------------------------------------------------------------------
// MessageItem
// ---------------------------------------------------------------------------

suite('MessageItem', () => {
  test('label is set correctly', () => {
    const item = new MessageItem('No classrooms found');
    assert.strictEqual(item.label, 'No classrooms found');
  });

  test('is non-collapsible', () => {
    const item = new MessageItem('test');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });
});

// ---------------------------------------------------------------------------
// ActionItem
// ---------------------------------------------------------------------------

suite('ActionItem', () => {
  test('label is set correctly', () => {
    const item = new ActionItem('Add organization…', 'classroom50.addOrg');
    assert.strictEqual(item.label, 'Add organization…');
  });

  test('command is set to the provided command id', () => {
    const item = new ActionItem('Add classroom…', 'classroom50.addClassroom');
    assert.strictEqual(item.command?.command, 'classroom50.addClassroom');
  });
});

// ---------------------------------------------------------------------------
// ClassroomTreeProvider.addClassroom / removeClassroom
// ---------------------------------------------------------------------------

 suite('ClassroomTreeProvider.addClassroom', () => {
  test('stores a new classroom for an org', async () => {
    const provider = makeProvider();
    await provider.addClassroom('cs50', 'fall-2026');
    const stored = (provider as unknown as { context: { globalState: MemoryMemento } }).context
      .globalState.get<unknown[]>('classrooms:cs50');
    assert.deepStrictEqual(stored, [{ slug: 'fall-2026', name: undefined }]);
  });

  test('does not add duplicate classrooms (case-insensitive)', async () => {
    const provider = makeProvider();
    await provider.addClassroom('cs50', 'fall-2026');
    await provider.addClassroom('cs50', 'Fall-2026');
    const stored = (provider as unknown as { context: { globalState: MemoryMemento } }).context
      .globalState.get<unknown[]>('classrooms:cs50');
    assert.strictEqual(stored?.length, 1);
  });

  test('preserves existing classrooms when adding a new one', async () => {
    const provider = makeProvider();
    await provider.addClassroom('cs50', 'fall-2026');
    await provider.addClassroom('cs50', 'spring-2027');
    const stored = (provider as unknown as { context: { globalState: MemoryMemento } }).context
      .globalState.get<unknown[]>('classrooms:cs50');
    const slugs = Array.isArray(stored) ? stored.map((e) => (typeof e === 'string' ? e : (e as any).slug)) : [];
    assert.ok(slugs.includes('fall-2026'));
    assert.ok(slugs.includes('spring-2027'));
  });

  test('clears the key when the last classroom is removed', async () => {
    const provider = makeProvider();
    await provider.addClassroom('cs50', 'fall-2026');
    await provider.removeClassroom('cs50', 'fall-2026');
    const stored = (provider as unknown as { context: { globalState: MemoryMemento } }).context
      .globalState.get<unknown[]>('classrooms:cs50');
    const slugs = Array.isArray(stored) ? stored.map((e) => (typeof e === 'string' ? e : (e as any).slug)) : [];
    assert.ok(stored === undefined || slugs.length === 0, 'Expected store to be cleared');
  });

  test('is a no-op when the classroom does not exist', async () => {
    const provider = makeProvider();
    await provider.addClassroom('cs50', 'fall-2026');
    await provider.removeClassroom('cs50', 'does-not-exist');
    const stored = (provider as unknown as { context: { globalState: MemoryMemento } }).context
      .globalState.get<unknown[]>('classrooms:cs50');
    assert.deepStrictEqual(stored, [{ slug: 'fall-2026', name: undefined }]);
  });
});
