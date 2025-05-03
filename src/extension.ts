import * as vscode from "vscode";
import { BifrostServerManager } from "./BifrostServerManager";
import { createDebugPanel } from "./debug/debugPanel";
import { findBifrostConfig } from "./core/config";
import { getPrimaryWorkspaceFolder } from "./utils/workspace";
import { Log } from "./core/log";

export async function activate(extensionContext: vscode.ExtensionContext) {
  let serverManager: BifrostServerManager | undefined;
  const subscriptions: vscode.Disposable[] = [];
  const log = Log.getInstance();

  try {
    // Initialize the server manager with context
    serverManager = BifrostServerManager.getInstance(extensionContext);

    // Handle workspace folder changes
    const workspaceChangeSubscription =
      vscode.workspace.onDidChangeWorkspaceFolders(async () => {
        const workspaceFolder = getPrimaryWorkspaceFolder();
        if (!workspaceFolder) {
          return;
        }
        const config = await findBifrostConfig(workspaceFolder);
        await serverManager?.restart(config!);
      });
    subscriptions.push(workspaceChangeSubscription);

    // Initial server start
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (workspaceFolder) {
      const config = await findBifrostConfig(workspaceFolder);
      await serverManager.start(config!);
    }

    // Register debug panel command
    const debugPanelCommand = vscode.commands.registerCommand(
      "bifrost-mcp.openDebugPanel",
      () => {
        createDebugPanel(extensionContext);
      }
    );
    subscriptions.push(debugPanelCommand);

    // Register server control commands
    const startServerCommand = vscode.commands.registerCommand(
      "bifrost-mcp.startServer",
      async () => {
        try {
          const workspaceFolder = getPrimaryWorkspaceFolder();
          if (!workspaceFolder) {
            return;
          }
          const config = await findBifrostConfig(workspaceFolder);
          await serverManager?.start(config!);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Failed to start MCP server: ${errorMsg}`
          );
          log.error(`Failed to start MCP server: ${errorMsg}`);
        }
      }
    );
    subscriptions.push(startServerCommand);

    const stopServerCommand = vscode.commands.registerCommand(
      "bifrost-mcp.stopServer",
      async () => {
        await serverManager?.stop();
        vscode.window.showInformationMessage("MCP server stopped");
      }
    );
    subscriptions.push(stopServerCommand);

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
