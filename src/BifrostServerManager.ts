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
import { mcpTools } from "./toolManager";
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
  private configWatcher?: vscode.FileSystemWatcher;
  private schemaCache = new Map<string, z.ZodType>();

  public static readonly SSE_PATH = "/sse";
  public static readonly MESSAGE_PATH = "/message";
  public static readonly HEALTH_PATH = "/health";

  private constructor(private context: vscode.ExtensionContext) {
    process.on("unhandledRejection", (reason) => {
      this.log.log("error", "UNHANDLED REJECTION 👉 " + reason);
    });
    
    this.log = new Log();
  }

  public static getInstance(context?: vscode.ExtensionContext): BifrostServerManager {
    if (!BifrostServerManager.instance) {
      if (!context) {
        throw new Error("Context is required for first initialization of BifrostServerManager");
      }
      BifrostServerManager.instance = new BifrostServerManager(context);
    }
    return BifrostServerManager.instance;
  }

  public async start(cfg: BifrostConfig): Promise<void> {
    if (this.http) {
      this.log.log("info", "Server already running; ignoring start()");
      return;
    }

    await this.stop(); // Ensure clean state

    // Set up config file watcher
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      this.configWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, "bifrost.config.json")
      );
      this.configWatcher.onDidChange(async () => {
        this.log.log("info", "Config file changed, restarting server...");
        const newCfg = await findBifrostConfig(workspaceFolder);
        await this.restart(newCfg);
      });
      this.context.subscriptions.push(this.configWatcher);
    }

    // Create MCP Server
    this.mcp = new Server(
      {
        name: cfg.projectName,
        version: "0.1.0",
        description: cfg.description,
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
      tools: mcpTools,
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
      this.log.log("debug", `Calling tool: ${name} with args: ${JSON.stringify(args)}`);
      
      const tool = mcpTools.find((t) => t.name === name);
      if (!tool) {
        this.log.log("error", `Tool "${name}" not found`);
        return {
          content: [{ type: "text", text: `Tool "${name}" not found` }],
          isError: true,
        };
      }

      const schema = this.createZodSchema(tool.inputSchema);
      const parsedArgs = schema.safeParse(args);
      if (!parsedArgs.success) {
        this.log.log("error", `Invalid arguments: ${JSON.stringify(parsedArgs.error.format())}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(parsedArgs.error.format(), null, 2),
            },
          ],
          isError: true,
        };
      }

      try {
        this.log.log("debug", `Running tool: ${name}`);
        const result = await runTool(name, parsedArgs.data);
        this.log.log("debug", `Tool ${name} completed successfully`);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        this.log.log("error", `Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    });

    const basePath = getProjectBasePath(cfg);
    this.app = this.buildApp(basePath, cfg);

    try {
      this.http = this.app.listen(cfg.port);
      const message = `MCP server listening on http://localhost:${cfg.port}${basePath}`;
      vscode.window.showInformationMessage(message);
      this.log.log("info", message);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        const newPort = await vscode.window.showInputBox({
          prompt: `Port ${cfg.port} is already in use. Please enter a new port number or press Enter to abort:`,
          value: String(cfg.port + 1),
          validateInput: (value) => {
            const port = parseInt(value);
            if (isNaN(port) || port < 1 || port > 65535) {
              return "Please enter a valid port number between 1 and 65535";
            }
            return null;
          },
        });

        if (!newPort) {
          this.log.log("info", "Server start aborted by user");
          return;
        }

        // Try again with new port
        cfg.port = parseInt(newPort);
        return this.start(cfg);
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      const fullError = `Failed to start server on configured port ${cfg.port}${basePath}. Please check if the port is available or configure a different port in bifrost.config.json. Error: ${errorMsg}`;
      vscode.window.showErrorMessage(fullError);
      this.log.log("error", fullError);
      throw new Error(fullError);
    }
  }

  public async stop(): Promise<void> {
    if (this.configWatcher) {
      this.configWatcher.dispose();
      this.configWatcher = undefined;
    }

    if (this.mcp) {
      this.mcp.close();
      this.mcp = undefined;
      this.log.log("info", "MCP server stopped");
    }

    if (this.http) {
      this.http.close();
      this.http = undefined;
      this.log.log("info", "HTTP server stopped");
    }

    this.app = undefined;

    // Clear all keep-alive intervals
    for (const [sessionId, interval] of this.keepAliveIntervals.entries()) {
      clearInterval(interval);
      this.keepAliveIntervals.delete(sessionId);
    }

    // Close all transports
    for (const transport of this.transports.values()) {
      await transport.close().catch((err) => {
        this.log.log("error", `Error closing transport: ${err}`);
      });
    }
    this.transports.clear();
  }

  public async restart(cfg: BifrostConfig): Promise<void> {
    this.log.log("info", "Restarting server...");
    await this.stop();
    await this.start(cfg);
  }

  public dispose(): void {
    this.log.log("info", "Disposing server manager...");
    this.stop();
    this.log.dispose();
  }

  private buildApp(basePath: string, cfg: BifrostConfig): express.Application {
    const app = express();
    app.use(cors());
    app.use(express.json());
    
    app.get(`${basePath}${BifrostServerManager.SSE_PATH}`, this.createSseHandler(basePath, cfg));
    app.post(`${basePath}${BifrostServerManager.MESSAGE_PATH}`, this.createMessageHandler(cfg));
    app.get(`${basePath}${BifrostServerManager.HEALTH_PATH}`, this.createHealthHandler(cfg));
    
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      this.log.log("error", "Unhandled express error: " + (err?.stack ?? err));
      res.status(500).json({ error: "Internal server error" });
    });
    
    return app;
  }

  private createSseHandler(
    basePath: string,
    cfg: BifrostConfig
  ): express.Handler {
    return async (req: Request, res: Response) => {
      this.log.log(
        "info",
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
          this.log.log(
            "info",
            `Server connected to SSE transport with session ID: ${sessionId} for project ${cfg.projectName}`
          );

          req.on("close", () => {
            this.log.log(
              "info",
              `SSE connection closed for session ${sessionId}`
            );
            clearInterval(this.keepAliveIntervals.get(sessionId));
            this.keepAliveIntervals.delete(sessionId);
            this.transports.delete(sessionId);
            transport.close().catch((err) => {
              this.log.log("error", `Error closing transport: ${err}`);
            });
          });
        } else {
          this.log.log("error", "MCP Server not initialized");
          res.status(500).end();
        }
      } catch (error) {
        this.log.log("error", `Error in SSE connection: ${error}`);
        res.status(500).end();
      }
    };
  }

  private createMessageHandler(cfg: BifrostConfig): express.Handler {
    return async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      this.log.log(
        "info",
        `Received message for session ${sessionId} in project ${cfg.projectName}: ${req.body?.method}`
      );

      const transport = this.transports.get(sessionId);
      if (!transport) {
        this.log.log("error", `No transport found for session ${sessionId}`);
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
        this.log.log("info", "Message handled successfully");
      } catch (error) {
        this.log.log("error", `Error handling message: ${error}`);
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

  private createZodSchema(jsonSchema: any): z.ZodType<any> {
    const schemaKey = JSON.stringify(jsonSchema);
    if (this.schemaCache.has(schemaKey)) {
      return this.schemaCache.get(schemaKey)!;
    }

    let schema: z.ZodType<any>;
    if (jsonSchema.type === 'object') {
      const shape: Record<string, z.ZodType<any>> = {};
      for (const [key, prop] of Object.entries(jsonSchema.properties || {})) {
        shape[key] = this.createZodSchema(prop);
      }
      schema = z.object(shape);
    } else if (jsonSchema.type === 'string') {
      schema = z.string();
    } else if (jsonSchema.type === 'number') {
      schema = z.number();
    } else if (jsonSchema.type === 'boolean') {
      schema = z.boolean();
    } else if (jsonSchema.type === 'array') {
      schema = z.array(this.createZodSchema(jsonSchema.items));
    } else {
      schema = z.any();
    }

    this.schemaCache.set(schemaKey, schema);
    return schema;
  }
}
