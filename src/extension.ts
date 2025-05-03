import * as vscode from "vscode";
import { BifrostServerManager } from "./BifrostServerManager";
import { createDebugPanel } from "./debug/debugPanel";
import { findBifrostConfig } from "./core/config";

export async function activate(extensionContext: vscode.ExtensionContext) {
    // Initialize the server manager with context
    const serverManager = BifrostServerManager.getInstance(extensionContext);

    // Handle workspace folder changes
    extensionContext.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                console.log("No workspace folder found");
                return;
            }
            const config = await findBifrostConfig(workspaceFolders[0]);
            await serverManager.restart(config!);
        })
    );

    // Initial server start
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const config = await findBifrostConfig(workspaceFolders[0]);
        await serverManager.start(config!);
    }

    // Register debug panel command
    extensionContext.subscriptions.push(
        vscode.commands.registerCommand("bifrost-mcp.openDebugPanel", () => {
            createDebugPanel(extensionContext);
        })
    );

    // Register server control commands
    extensionContext.subscriptions.push(
        vscode.commands.registerCommand("bifrost-mcp.startServer", async () => {
            try {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage("No workspace folder found");
                    return;
                }
                const config = await findBifrostConfig(workspaceFolders[0]);
                await serverManager.start(config!);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(
                    `Failed to start MCP server: ${errorMsg}`
                );
            }
        }),
        vscode.commands.registerCommand("bifrost-mcp.stopServer", async () => {
            await serverManager.stop();
            vscode.window.showInformationMessage("MCP server stopped");
        })
    );
}

export function deactivate() {
    BifrostServerManager.getInstance().dispose();
}
