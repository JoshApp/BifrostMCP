import * as vscode from "vscode";
import { BifrostServerManager } from "./BifrostServerManager";
import { Log } from "./core/log";
import { registerServerCommands } from "./commands/serverCommands";
import { registerDebugCommands } from "./commands/debugCommands";

export async function activate(extensionContext: vscode.ExtensionContext) {
  let serverManager: BifrostServerManager | undefined;
  const subscriptions: vscode.Disposable[] = [];
  const log = Log.getInstance();

  try {
    // Initialize the server manager with context
    serverManager = await BifrostServerManager.getInstance(extensionContext).initialize();

    // Register all commands
    subscriptions.push(...registerDebugCommands(extensionContext));
    if (serverManager) {
      subscriptions.push(...registerServerCommands(extensionContext, serverManager));
    }

    // Add all subscriptions to the extension context
    subscriptions.forEach((sub) => extensionContext.subscriptions.push(sub));
  } catch (error) {
    // Clean up any resources that were created
    await serverManager?.dispose();
    subscriptions.forEach((sub) => sub.dispose());

    // Show error to user and log it
    const errorMsg = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Failed to activate Bifrost MCP: ${errorMsg}`
    );
    log.error(`Failed to activate Bifrost MCP: ${errorMsg}`);

    // Re-throw to ensure VS Code knows activation failed
    throw error;
  }
}

export function deactivate() {
  // Safe to call even if activation failed
  BifrostServerManager.getExistingInstance()?.dispose();
}
