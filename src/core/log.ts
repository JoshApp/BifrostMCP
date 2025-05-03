import * as vscode from "vscode";

type Level = "debug" | "info" | "error";

export class Log {
  constructor(private chan = vscode.window.createOutputChannel("Bifrost")) {}

  log(level: Level, msg: string) {
    const tag = level.toUpperCase().padEnd(5);
    this.chan.appendLine(`[${tag}] ${msg}`);
  }

  dispose() {
    this.chan.dispose();
  }
}
