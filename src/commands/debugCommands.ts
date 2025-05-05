import * as vscode from "vscode";
import { DebugPanel } from "../debug/debugPanel";

export function registerDebugCommands(
  context: vscode.ExtensionContext
): vscode.Disposable[] {
  const subscriptions: vscode.Disposable[] = [];

  // Register debug panel command
  const debugPanelCommand = vscode.commands.registerCommand(
    "bifrost-mcp.openDebugPanel",
    () => {
      DebugPanel.open(context);
    }
  );
  subscriptions.push(debugPanelCommand);

  // Register WebviewPanelSerializer for mcpDebug
  const serializer = vscode.window.registerWebviewPanelSerializer('mcpDebug', {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
      DebugPanel.revive(panel, context);
    }
  });
  subscriptions.push(serializer);

  return subscriptions;
} 