import * as vscode from "vscode";

/**
 * Gets the primary workspace folder, showing an error message if none is found.
 * @returns The primary workspace folder or undefined if none is found
 */
export function getPrimaryWorkspaceFolder():
  | vscode.WorkspaceFolder
  | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage("No workspace folder found");
    return undefined;
  }
  return workspaceFolders[0];
}
