import * as vscode from "vscode";
import { EventEmitter } from "vscode";
import { Log } from "./log";
import { z } from "zod";

export interface BifrostConfig {
  projectName: string;
  description: string;
  /** base URL path ("/api" → server runs at /api/sse etc.) */
  path: string;
  port: number;
}

export const DEFAULT_CONFIG: Readonly<BifrostConfig> = {
  projectName: "language-tools",
  description: "Language tools and code analysis",
  path: "",
  port: 8008,
};

const ConfigSchema = z
  .object({
    projectName: z.string().min(1),
    description: z.string().min(1),
    path: z.string().default(""),
    port: z.number().int().positive().max(65535).default(DEFAULT_CONFIG.port),
  })
  .strict();

export class ConfigService {
  private static instance: ConfigService;
  private config: BifrostConfig = { ...DEFAULT_CONFIG };
  private configUri?: vscode.Uri;
  private watcher?: vscode.FileSystemWatcher;
  private restartTimeout?: NodeJS.Timeout;
  private readonly log: Log;

  private readonly _onConfigChange = new EventEmitter<BifrostConfig>();
  public readonly onConfigChange = this._onConfigChange.event;

  private constructor(private context: vscode.ExtensionContext) {
    this.log = Log.getInstance();
  }

  public static getInstance(context: vscode.ExtensionContext): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService(context);
    }
    return ConfigService.instance;
  }

  public static getExistingInstance(): ConfigService | undefined {
    return ConfigService.instance;
  }

  private async parseConfig(uri: vscode.Uri): Promise<BifrostConfig> {
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const json = JSON.parse(Buffer.from(raw).toString("utf8"));
      return ConfigSchema.parse(json);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        const message =
          `Invalid bifrost.config.json at ${uri.fsPath}: ` +
          err.errors.map((e) => e.message).join(", ");
        this.log.error(message);
        throw err;
      }
      throw err;
    }
  }

  private async setConfig(uri: vscode.Uri | undefined): Promise<void> {
    if (!uri) {
      this.config = { ...DEFAULT_CONFIG };
      this.configUri = undefined;
      this._onConfigChange.fire(this.config);
      return;
    }

    try {
      const config = await this.parseConfig(uri);
      this.config = config;
      this.configUri = uri;
      this._onConfigChange.fire(config);
    } catch (error) {
      this.log.info(
        `No valid config found at ${uri.fsPath}, using default config`
      );
      this.config = { ...DEFAULT_CONFIG };
      this.configUri = undefined;
      this._onConfigChange.fire(this.config);
    }
  }

  public async initialize(): Promise<void> {
    // Get the primary workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      this.log.info("No workspace folders found, using default config");
      await this.setConfig(undefined);
      return;
    }

    const primaryFolder = workspaceFolders[0];
    const configUri = vscode.Uri.joinPath(
      primaryFolder.uri,
      "bifrost.config.json"
    );

    await this.setConfig(configUri);
    this.setupWatcher(primaryFolder);
  }

  private setupWatcher(folder: vscode.WorkspaceFolder): void {
    // Clean up existing watcher
    if (this.watcher) {
      this.watcher.dispose();
    }

    // Create new watcher
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, "bifrost.config.json")
    );

    // Handle config changes
    this.watcher.onDidChange((uri) => this.handleConfigChange(folder, uri));
    this.watcher.onDidCreate((uri) => this.handleConfigChange(folder, uri));
    this.watcher.onDidDelete((uri) => this.handleConfigChange(folder, uri));

    this.context.subscriptions.push(this.watcher);
  }

  private async handleConfigChange(
    folder: vscode.WorkspaceFolder,
    uri: vscode.Uri
  ): Promise<void> {
    // Clear any existing timeout
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }

    // Set a new timeout for config reload
    this.restartTimeout = setTimeout(async () => {
      try {
        // Check if the file still exists
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          this.log.info(
            `Config file deleted: ${uri.fsPath}, using default config`
          );
          await this.setConfig(undefined);
          return;
        }

        // Only reload if this is our current config file
        if (this.configUri && this.configUri?.toString() !== uri.toString()) {
          this.log.info(
            `Ignoring change to non-current config file: ${uri.fsPath}`
          );
          return;
        }

        this.log.info(`Config file changed: ${uri.fsPath}`);
        await this.setConfig(uri);
      } catch (error) {
        this.log.error(
          `Error handling config change: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }, 250);
  }

  public getConfig(): BifrostConfig {
    return this.config;
  }

  public dispose(): void {
    if (this.watcher) {
      this.watcher.dispose();
    }
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }
    this._onConfigChange.dispose();
  }

  public static formatBasePath(config: BifrostConfig): string {
    const p = config.path.trim();
    if (!p) {
      return "";
    }
    return p.startsWith("/")
      ? p.replace(/\/+$/, "")
      : `/${p.replace(/\/+$/, "")}`;
  }
}
