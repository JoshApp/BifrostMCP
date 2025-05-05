import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { toolsDescriptions, getToolUiDescriptors, ToolUiDescriptor } from "../toolManager";
import { BifrostServerManager } from "../BifrostServerManager";
import { runTool } from "../toolManager";
import { Log } from "../core/log";

const PANEL_KEY = "debugPanelWeakRef";
const log = Log.getInstance();

// Fix for WeakRef type error in TypeScript environments
// @ts-ignore
declare var WeakRef: any;
// @ts-ignore
const SafeWeakRef =
  typeof WeakRef !== "undefined"
    ? WeakRef
    : class<T> {
        private value: T;
        constructor(value: T) {
          this.value = value;
        }
        deref() {
          return this.value;
        }
      };

// Message protocol types
export type ExtensionToWebviewMessage =
  | { type: "files"; files: { uri: string; label: string }[] }
  | { type: "currentFile"; tool: string; uri: string }
  | { type: "currentFile"; tool: string; error: string }
  | { type: "result"; tool: string; result: any; isError: boolean }
  | { type: "fileAdd"; file: { uri: string; label: string } }
  | { type: "fileRemove"; file: { uri: string; label: string } }
  | { type: "init"; toolsDescriptions: { name: string; description: string }[] }
  | { type: "toolDescriptors"; tools: ToolUiDescriptor[] };

export type WebviewToExtensionMessage =
  | { command: "getCurrentFile"; tool: string }
  | { command: "execute"; tool: string; params: any };

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class DebugPanel {
  private static weakPanel: any;
  private static panelDisposables: vscode.Disposable | undefined;
  private static fileList: { uri: string; label: string }[] = [];
  private static debounceUpdateFiles: (() => void) | undefined;

  private static async readAllFilesInWorkspace(): Promise<{ uri: string; label: string }[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }
    const files: { uri: string; label: string }[] = [];
    async function readDirRecursively(folder: vscode.Uri) {
      const entries = await vscode.workspace.fs.readDirectory(folder);
      for (const [name, type] of entries) {
        const uri = vscode.Uri.joinPath(folder, name);
        if (type === vscode.FileType.File) {
          files.push({
            uri: uri.toString(),
            label: vscode.workspace.asRelativePath(uri)
          });
        } else if (type === vscode.FileType.Directory) {
          await readDirRecursively(uri);
        }
      }
    }
    for (const folder of workspaceFolders) {
      await readDirRecursively(folder.uri);
    }
    return files;
  }

  static open(context: vscode.ExtensionContext) {
    let panel = this.weakPanel?.deref();
    if (panel) {
      panel.reveal();
      return;
    }
    panel = vscode.window.createWebviewPanel(
      "mcpDebug",
      "MCP Debug Panel",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "media")),
        ],
      }
    );
    this.setupPanel(panel, context);
    this.weakPanel = new SafeWeakRef(panel);
    context.globalState.update(PANEL_KEY, this.weakPanel);
  }

  static revive(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.setupPanel(panel, context);
    this.weakPanel = new SafeWeakRef(panel);
    context.globalState.update(PANEL_KEY, this.weakPanel);
  }

  static dispose() {
    this.weakPanel = undefined;
    if (this.panelDisposables) {
      this.panelDisposables.dispose();
      this.panelDisposables = undefined;
    }
    this.fileList = [];
    this.debounceUpdateFiles = undefined;
  }

  private static async getWebviewHtml(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    const nonce = getNonce();
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "panel.js"));
    const styleUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "panel.css"));
    const html = (await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(context.extensionUri, "media", "panel.html")))
      .toString()
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{scriptUri}}/g, scriptUri.toString())
      .replace(/{{styleUri}}/g, styleUri.toString());
    return { html, nonce };
  }

  private static setupPanel(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext
  ) {
    // Debounce function (if lodash is not available, use this simple debounce)
    function simpleDebounce<T extends (...args: any[]) => void>(
      fn: T,
      wait: number
    ): T {
      let timeout: NodeJS.Timeout | undefined;
      return function (this: any, ...args: any[]) {
        if (timeout) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(() => fn.apply(this, args), wait);
      } as T;
    }

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(
      async (message: WebviewToExtensionMessage) => {
        // Only log non-autocomplete related messages
        if (message.command !== "getCurrentFile") {
          log.debug(`Webview -> Extension: ${JSON.stringify(message)}`);
        }
        if (message.command === "getCurrentFile") {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            const uri = editor.document.uri;
            const msg: ExtensionToWebviewMessage = {
              type: "currentFile",
              tool: message.tool,
              uri: uri.toString(),
            };
            panel?.webview.postMessage(msg);
          } else {
            const msg: ExtensionToWebviewMessage = {
              type: "currentFile",
              tool: message.tool,
              error: "No active editor found",
            };
            panel?.webview.postMessage(msg);
            vscode.window.showInformationMessage(
              "Please open a file in the editor to use this feature"
            );
          }
        } else if (
          message.command === "execute" &&
          BifrostServerManager.getInstance(context)
        ) {
          try {
            const result = await runTool(message.tool, message.params);
            const msg: ExtensionToWebviewMessage = {
              type: "result",
              tool: message.tool,
              result: result,
              isError: false
            };
            log.debug(`Extension -> Webview: ${JSON.stringify(msg)}`);
            panel?.webview.postMessage(msg);
          } catch (error) {
            const msg: ExtensionToWebviewMessage = {
              type: "result",
              tool: message.tool,
              result: { error: String(error) },
              isError: true
            };
            log.debug(`Extension -> Webview: ${JSON.stringify(msg)}`);
            panel?.webview.postMessage(msg);
          }
        }
      }
    );

    // Initial file list
    this.readAllFilesInWorkspace().then((files) => {
      this.fileList = files;
      const msg: ExtensionToWebviewMessage = {
        type: "files",
        files: this.fileList,
      };
      panel?.webview.postMessage(msg);
    });

    const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*");
    const createDisposable = fileWatcher.onDidCreate((uri) => {
      const fileInfo = {
        uri: uri.toString(),
        label: vscode.workspace.asRelativePath(uri)
      };
      if (!this.fileList.some(f => f.uri === fileInfo.uri)) {
        this.fileList.push(fileInfo);
        const msg: ExtensionToWebviewMessage = {
          type: "fileAdd",
          file: fileInfo,
        };
        panel?.webview.postMessage(msg);
      }
    });
    const deleteDisposable = fileWatcher.onDidDelete((uri) => {
      const idx = this.fileList.findIndex(f => f.uri === uri.toString());
      if (idx !== -1) {
        const fileInfo = this.fileList[idx];
        this.fileList.splice(idx, 1);
        const msg: ExtensionToWebviewMessage = {
          type: "fileRemove",
          file: fileInfo,
        };
        panel?.webview.postMessage(msg);
      }
    });
    this.panelDisposables = vscode.Disposable.from(
      fileWatcher,
      createDisposable,
      deleteDisposable
    );

    panel.onDidDispose(() => {
      this.dispose();
    });

    // Set up the webview HTML and send initial data
    this.getWebviewHtml(panel, context).then(({ html }) => {
      panel.webview.html = html;
      // Wait for the webview to load, then send initial data
      setTimeout(() => {
        panel.webview.postMessage({
          type: "init",
          toolsDescriptions,
        });
        panel.webview.postMessage({
          type: "toolDescriptors",
          tools: getToolUiDescriptors()
        });
      }, 100);
    });
  }
}
