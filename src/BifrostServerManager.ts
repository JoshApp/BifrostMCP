import * as vscode from "vscode";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import cors from "cors";
import type { Server as HttpServer } from "http";
import { Request, Response } from "express";
import { parsedMcpTools, toolMap } from "./toolManager";
import { runTool } from "./toolManager";
import {
  BifrostConfig,
  getProjectBasePath,
  findBifrostConfig,
} from "./core/config";
import { Log } from "./core/log";
import { z } from "zod";

export class BifrostServerManager {
  private static instance: BifrostServerManager;
  private mcp?: Server;
  private http?: HttpServer;
  private transports = new Map<string, SSEServerTransport>();
  private app?: express.Application;
  private keepAliveIntervals = new Map<string, NodeJS.Timeout>();
  private log: Log;
  private configWatchers: vscode.FileSystemWatcher[] = [];
  private statusBarItem: vscode.StatusBarItem;
  private starting?: Promise<void>;
  private currentConfig?: BifrostConfig;
  private restartTimeouts = new Map<string, NodeJS.Timeout>();

  // Cross-platform timing function
  private readonly now =
    globalThis.performance?.now?.bind(globalThis.performance) ?? Date.now;

  public static readonly SSE_PATH = "/sse";
  public static readonly MESSAGE_PATH = "/message";
  public static readonly HEALTH_PATH = "/health";

  private constructor(private context: vscode.ExtensionContext) {
    process.on("unhandledRejection", (reason) => {
      this.log.error("UNHANDLED REJECTION 👉 " + reason);
    });

    this.log = Log.getInstance();

    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "bifrost-mcp.openDebugPanel";
    this.updateStatusBar(false);
    this.statusBarItem.show();
  }

  public static getInstance(
    context: vscode.ExtensionContext
  ): BifrostServerManager {
    if (!BifrostServerManager.instance) {
      if (!context) {
        throw new Error(
          "Context is required for initial BifrostServerManager creation"
        );
      }
      BifrostServerManager.instance = new BifrostServerManager(context);
    }
    return BifrostServerManager.instance;
  }

  /**
   * Gets the existing instance of BifrostServerManager if one has been created.
   * Returns undefined if no instance exists.
   */
  public static getExistingInstance(): BifrostServerManager | undefined {
    return BifrostServerManager.instance;
  }

  private updateStatusBar(isRunning: boolean): void {
    if (isRunning) {
      this.statusBarItem.text = "$(radio-tower) MCP: Running";
      this.statusBarItem.tooltip = "MCP Server is running";
      this.statusBarItem.color = undefined;
    } else {
      this.statusBarItem.text = "$(debug-disconnect) MCP: Stopped";
      this.statusBarItem.tooltip = "MCP Server is stopped";
      this.statusBarItem.color = new vscode.ThemeColor(
        "statusBarItem.errorForeground"
      );
    }
  }

  private async handleConfigChange(
    folder: vscode.WorkspaceFolder,
    uri: vscode.Uri
  ): Promise<void> {
    const key = folder.uri.toString();

    // Clear any existing timeout for this folder
    const existingTimeout = this.restartTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set a new timeout for restart
    const timeout = setTimeout(async () => {
      try {
        // Check if the file still exists
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          this.log.info(`Config file deleted: ${uri.fsPath}`);
          this.currentConfig = undefined;
          this.restartTimeouts.delete(key);
          await this.stop();
          return;
        }

        // Get the new config
        const newCfg = await findBifrostConfig(folder);

        // Skip restart if the config hasn't changed
        if (
          this.currentConfig &&
          JSON.stringify(newCfg) === JSON.stringify(this.currentConfig)
        ) {
          this.log.info(`Config file changed but content is identical`);
          return;
        }

        this.log.info(`Config file changed: ${uri.fsPath}`);
        await this.restart(newCfg);
      } catch (error) {
        this.log.error(
          `Error handling config change: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      } finally {
        this.restartTimeouts.delete(key);
      }
    }, 250);

    this.restartTimeouts.set(key, timeout);
  }

  public async start(cfg: BifrostConfig): Promise<void> {
    // If we're already starting, wait for that to complete and return
    if (this.starting) {
      this.log.info("Server start already in progress; waiting for completion");
      await this.starting;
      return;
    }

    // Create a new promise to track this start operation
    this.starting = (async () => {
      try {
        if (this.http) {
          this.log.info("Server already running; ignoring start()");
          return;
        }

        await this.stop(); // Ensure clean state

        // Create a local copy of the config to avoid mutating the caller's object
        const localConfig = { ...cfg };
        this.currentConfig = localConfig;

        // Set up config file watchers for each workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
          // Create a watcher for each workspace folder
          for (const folder of workspaceFolders) {
            const watcher = vscode.workspace.createFileSystemWatcher(
              new vscode.RelativePattern(folder, "**/bifrost.config.json")
            );

            // Handle all file events
            watcher.onDidChange((uri) => this.handleConfigChange(folder, uri));
            watcher.onDidCreate((uri) => this.handleConfigChange(folder, uri));
            watcher.onDidDelete((uri) => this.handleConfigChange(folder, uri));

            this.configWatchers.push(watcher);
            this.context.subscriptions.push(watcher);
          }
        }

        // Create MCP Server
        this.mcp = new Server(
          {
            name: localConfig.projectName,
            version: "0.1.0",
            description: localConfig.description,
          },
          {
            capabilities: {
              tools: {},
              resources: {},
            },
          }
        );

        // Set up MCP handlers
        this.mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: parsedMcpTools,
        }));

        this.mcp.setRequestHandler(ListResourcesRequestSchema, async () => ({
          resources: [],
        }));

        this.mcp.setRequestHandler(
          ListResourceTemplatesRequestSchema,
          async () => ({
            templates: [],
          })
        );

        this.mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
          const { name, arguments: args } = request.params;
          this.log.debug(
            `Calling tool: ${name} with args: ${JSON.stringify(args)}`
          );

          const tool = parsedMcpTools.find((t) => t.name === name);
          if (!tool) {
            this.log.error(`Tool "${name}" not found`);
            return {
              content: [{ type: "text", text: `Tool "${name}" not found` }],
              isError: true,
            };
          }

          const parsedArgs = toolMap.get(name)?.schema.safeParse(args);
          if (!parsedArgs?.success) {
            this.log.error(
              `Invalid arguments: ${JSON.stringify(
                parsedArgs?.error?.format()
              )}`
            );
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(parsedArgs?.error?.format(), null, 2),
                },
              ],
              isError: true,
            };
          }

          try {
            this.log.debug(`Running tool: ${name}`);
            const result = await this.runTool(name, parsedArgs.data);
            this.log.debug(`Tool ${name} completed successfully`);
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
            };
          } catch (error) {
            this.log.error(
              `Tool ${name} failed: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text", text: `Error: ${errorMessage}` }],
              isError: true,
            };
          }
        });

        const basePath = getProjectBasePath(localConfig);
        this.app = this.buildApp(basePath, localConfig);

        try {
          this.http = this.app.listen(localConfig.port);
          const message = `MCP server listening on http://localhost:${localConfig.port}${basePath}`;
          vscode.window.showInformationMessage(message);
          this.log.info(message);
          this.updateStatusBar(true);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
            const newPort = await vscode.window.showInputBox({
              prompt: `Port ${localConfig.port} is already in use. Please enter a new port number or press Enter to abort:`,
              value: String(localConfig.port + 1),
              validateInput: (value) => {
                const port = parseInt(value);
                if (isNaN(port) || port < 1 || port > 65535) {
                  return "Please enter a valid port number between 1 and 65535";
                }
                return null;
              },
            });

            if (!newPort) {
              this.log.info("Server start aborted by user");
              return;
            }

            // Try again with new port in local config
            localConfig.port = parseInt(newPort);
            return this.start(localConfig);
          }

          const errorMsg =
            error instanceof Error ? error.message : String(error);
          const fullError = `Failed to start server on configured port ${localConfig.port}${basePath}. Please check if the port is available or configure a different port in bifrost.config.json. Error: ${errorMsg}`;
          vscode.window.showErrorMessage(fullError);
          this.log.error(fullError);
          this.updateStatusBar(false);
          throw new Error(fullError);
        }
      } finally {
        // Clear the starting promise when done
        this.starting = undefined;
      }
    })();

    return this.starting;
  }

  public async stop(): Promise<void> {
    // Clear all restart timeouts
    for (const timeout of this.restartTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.restartTimeouts.clear();

    // Dispose all config watchers
    for (const watcher of this.configWatchers) {
      watcher.dispose();
    }
    this.configWatchers = [] as vscode.FileSystemWatcher[];

    if (this.mcp) {
      this.mcp.close();
      this.mcp = undefined;
      this.log.info("MCP server stopped");
    }

    if (this.http) {
      this.http.close();
      this.http = undefined;
      this.log.info("HTTP server stopped");
    }

    this.app = undefined;
    this.currentConfig = undefined;

    // Clear all keep-alive intervals
    for (const [sessionId, interval] of this.keepAliveIntervals.entries()) {
      clearInterval(interval);
      this.keepAliveIntervals.delete(sessionId);
    }

    // Close all transports
    for (const transport of this.transports.values()) {
      await transport.close().catch((err) => {
        this.log.error(`Error closing transport: ${err}`);
      });
    }
    this.transports.clear();

    this.updateStatusBar(false);
  }

  public async restart(cfg: BifrostConfig): Promise<void> {
    // If we're already starting, wait for that to complete first
    if (this.starting) {
      this.log.info("Server start in progress; waiting before restart");
      await this.starting;
    }

    this.log.info("Restarting server...");
    await this.stop();
    await this.start(cfg);
  }

  public dispose(): void {
    this.log.info("Disposing server manager...");
    this.stop();
    this.statusBarItem.dispose();
    this.log.dispose();
  }

  private buildApp(basePath: string, cfg: BifrostConfig): express.Application {
    const app = express();
    app.use(cors());
    app.use(express.json());

    app.get(
      `${basePath}${BifrostServerManager.SSE_PATH}`,
      this.createSseHandler(basePath, cfg)
    );
    app.post(
      `${basePath}${BifrostServerManager.MESSAGE_PATH}`,
      this.createMessageHandler(cfg)
    );
    app.get(
      `${basePath}${BifrostServerManager.HEALTH_PATH}`,
      this.createHealthHandler(cfg)
    );

    app.use(
      (
        err: any,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        this.log.error("Unhandled express error: " + (err?.stack ?? err));
        res.status(500).json({ error: "Internal server error" });
      }
    );

    return app;
  }

  private createSseHandler(
    basePath: string,
    cfg: BifrostConfig
  ): express.Handler {
    return async (req: Request, res: Response) => {
      this.log.info(
        `New SSE connection attempt for project ${cfg.projectName}`
      );

      req.socket.setTimeout(0);
      req.socket.setNoDelay(true);
      req.socket.setKeepAlive(true);

      try {
        const transport = this.newTransport(basePath, res);
        const sessionId = transport.sessionId;
        this.transports.set(sessionId, transport);

        const keepAliveInterval = setInterval(() => {
          if (res.writable) {
            res.write(": keepalive\n\n");
          }
        }, 30000);
        this.keepAliveIntervals.set(sessionId, keepAliveInterval);

        if (this.mcp) {
          await this.mcp.connect(transport);
          this.log.info(
            `Server connected to SSE transport with session ID: ${sessionId} for project ${cfg.projectName}`
          );

          req.on("close", () => {
            this.log.info(`SSE connection closed for session ${sessionId}`);
            clearInterval(this.keepAliveIntervals.get(sessionId));
            this.keepAliveIntervals.delete(sessionId);
            this.transports.delete(sessionId);
            transport.close().catch((err) => {
              this.log.error(`Error closing transport: ${err}`);
            });
          });
        } else {
          this.log.error("MCP Server not initialized");
          res.status(500).end();
        }
      } catch (error) {
        this.log.error(`Error in SSE connection: ${error}`);
        res.status(500).end();
      }
    };
  }

  private createMessageHandler(cfg: BifrostConfig): express.Handler {
    return async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      this.log.info(
        `Received message for session ${sessionId} in project ${cfg.projectName}: ${req.body?.method}`
      );

      const transport = this.transports.get(sessionId);
      if (!transport) {
        this.log.error(`No transport found for session ${sessionId}`);
        res.status(400).json({
          jsonrpc: "2.0",
          id: req.body?.id,
          error: {
            code: -32000,
            message: "No active session found",
          },
        });
        return;
      }

      try {
        await transport.handlePostMessage(req, res, req.body);
        this.log.info("Message handled successfully");
      } catch (error) {
        this.log.error(`Error handling message: ${error}`);
        res.status(500).json({
          jsonrpc: "2.0",
          id: req.body?.id,
          error: {
            code: -32000,
            message: String(error),
          },
        });
      }
    };
  }

  private createHealthHandler(cfg: BifrostConfig): express.Handler {
    return (req: Request, res: Response) => {
      res.status(200).json({
        status: "ok",
        project: cfg.projectName,
        description: cfg.description,
      });
    };
  }

  private newTransport(basePath: string, res: Response): SSEServerTransport {
    return new SSEServerTransport(
      `${basePath}${BifrostServerManager.MESSAGE_PATH}`,
      res
    );
  }

  private async runTool(name: string, args: unknown): Promise<unknown> {
    const tool = parsedMcpTools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }

    const startTime = this.now();
    try {
      // Run the tool directly - validation will happen in toolManager.runTool()
      const toolResult = await runTool(name, args);
      const duration = this.now() - startTime;

      // Log performance metrics
      this.log.info(`Tool "${name}" completed in ${duration.toFixed(2)}ms`);

      // Return result with performance metrics
      return {
        result: toolResult,
        metrics: {
          duration: duration,
          tool: name,
        },
      };
    } catch (error) {
      const duration = this.now() - startTime;

      // Format ZodError as pretty JSON in a markdown code block
      if (error instanceof z.ZodError) {
        const errorMessage =
          "```json\n" + JSON.stringify(error.format(), null, 2) + "\n```";
        this.log.error(
          `Tool "${name}" failed after ${duration.toFixed(
            2
          )}ms: ${errorMessage}`
        );
        throw new Error(errorMessage);
      }

      this.log.error(
        `Tool "${name}" failed after ${duration.toFixed(2)}ms: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }
}
