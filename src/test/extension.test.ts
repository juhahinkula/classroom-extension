import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension smoke tests', () => {
  test('VS Code API is accessible in the test environment', () => {
    // Verifies the test harness has loaded VS Code correctly.
    assert.ok(vscode.version, 'Expected a non-empty VS Code version string');
  });

  test('getCommands returns an array of registered commands', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(Array.isArray(all), 'Expected getCommands to return an array');
    assert.ok(all.length > 0, 'Expected at least one registered command');
  });
});
