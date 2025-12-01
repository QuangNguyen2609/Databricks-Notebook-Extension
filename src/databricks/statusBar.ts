import * as vscode from 'vscode';
import { ProfileManager } from './profileManager';

export class DatabricksStatusBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private profileManager: ProfileManager;

  constructor(profileManager: ProfileManager) {
    this.profileManager = profileManager;

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'databricks-notebook.selectProfile';

    // Subscribe to profile changes
    profileManager.onDidChangeProfile(() => this.update());
    profileManager.onDidChangeProfiles(() => this.update());

    this.update();
    this.statusBarItem.show();
  }

  private update(): void {
    const profile = this.profileManager.getSelectedProfile();

    if (profile) {
      this.statusBarItem.text = `$(cloud) ${profile.name}`;
      this.statusBarItem.tooltip = new vscode.MarkdownString(
        `**Databricks Profile**: ${profile.name}\n\n` +
        `**Host**: ${profile.host}\n\n` +
        `Click to switch profiles`
      );
      this.statusBarItem.backgroundColor = undefined;
    } else if (this.profileManager.hasProfiles()) {
      this.statusBarItem.text = `$(cloud) No Profile`;
      this.statusBarItem.tooltip = 'Click to select a Databricks profile';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.statusBarItem.text = `$(cloud) No Config`;
      this.statusBarItem.tooltip = 'No Databricks profiles found in ~/.databrickscfg';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
