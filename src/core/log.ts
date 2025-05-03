import * as vscode from "vscode";

type Level = "debug" | "info" | "warn" | "error";

export class Log {
  private static instance: Log;
  private readonly channel: vscode.OutputChannel;

  private constructor() {
    this.channel = vscode.window.createOutputChannel("Bifrost MCP");
  }

  public static getInstance(): Log {
    if (!Log.instance) {
      Log.instance = new Log();
    }
    return Log.instance;
  }

  log(level: Level, msg: string) {
    const tag = level.toUpperCase().padEnd(5);
    const timestamp = new Date().toISOString();
    this.channel.appendLine(`[${timestamp}] [${tag}] ${msg}`);
  }

  debug(msg: string) {
    this.log("debug", msg);
  }

  info(msg: string) {
    this.log("info", msg);
  }

  warn(msg: string) {
    this.log("warn", msg);
  }

  error(msg: string) {
    this.log("error", msg);
  }

  dispose() {
    this.channel.dispose();
  }
}
