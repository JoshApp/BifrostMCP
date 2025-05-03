import * as vscode from "vscode";
import * as path from "path";
import { z } from "zod";
import { Log } from "./log";

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

/* ─────────────────────────────────────────────────────────── */

const ConfigSchema = z
  .object({
    projectName: z.string().min(1),
    description: z.string().min(1),
    path: z.string().default(""),
    port: z.number().int().positive().max(65535).default(DEFAULT_CONFIG.port),
  })
  .strict();

const log = new Log();

/** Read & validate bifrost.config.json or return defaults */
export async function findBifrostConfig(
  folder: vscode.WorkspaceFolder
): Promise<BifrostConfig> {
  const uri = vscode.Uri.joinPath(folder.uri, "bifrost.config.json");

  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const json = JSON.parse(Buffer.from(raw).toString("utf8"));
    const parsed = ConfigSchema.parse(json); // throws if invalid
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err: any) {
    // File missing → return defaults silently.
    if (err?.code === "FileNotFound" || err?.name === "FileSystemError") {
      log.log(
        "info",
        `No bifrost.config.json in ${folder.name}; using defaults`
      );
      return { ...DEFAULT_CONFIG };
    }

    // Validation or JSON syntax error → bubble up to caller/UX.
    const message =
      err instanceof z.ZodError
        ? "Invalid bifrost.config.json: " +
          err.errors.map((e) => e.message).join(", ")
        : `Cannot read bifrost.config.json: ${err.message ?? err}`;
    vscode.window.showErrorMessage(message);
    log.log("error", message);
    throw err;
  }
}

/** Normalise the base URL path (always starts with `/`, never ends with `/`) */
export function getProjectBasePath(cfg: BifrostConfig): string {
  const p = cfg.path.trim();
  if (!p) {
    return "";
  }
  return p.startsWith("/")
    ? p.replace(/\/+$/, "")
    : `/${p.replace(/\/+$/, "")}`;
}
