import * as vscode from "vscode";
import { BifrostServerManager } from "../BifrostServerManager";
import { ConfigService } from "../core/configService";
import { Log } from "../core/log";

export function registerServerCommands(
  context: vscode.ExtensionContext,
  serverManager: BifrostServerManager
): vscode.Disposable[] {
  const subscriptions: vscode.Disposable[] = [];
  const log = Log.getInstance();

  // Register server control commands
  const startServerCommand = vscode.commands.registerCommand(
    "bifrost-mcp.startServer",
    async () => {
      try {
        const configService = ConfigService.getExistingInstance();
        if (!configService) {
          vscode.window.showErrorMessage("Config service not initialized");
          return;
        }

        const config = configService.getConfig();
        if (!config) {
          vscode.window.showErrorMessage("No valid configuration found");
          return;
        }

        await serverManager?.start(config);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
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

  return subscriptions;
} 