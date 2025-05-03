import * as vscode from "vscode";
import { z } from "zod";
import { ToolDefinition, ToolDescription, ToolDef } from "./types/tools";
import { find_usages } from "./tools/find_usages";
import { go_to_definition } from "./tools/go_to_definition";
import { find_implementations } from "./tools/find_implementations";
import { get_hover_info } from "./tools/get_hover_info";
import { get_document_symbols } from "./tools/get_document_symbols";
import { get_completions } from "./tools/get_completions";
import { get_signature_help } from "./tools/get_signature_help";
import { get_rename_locations } from "./tools/get_rename_locations";
import { get_document_highlights } from "./tools/get_document_highlights";
import { get_workspace_symbols } from "./tools/get_workspace_symbols";
import { get_code_actions } from "./tools/get_code_actions";
import { get_code_lens } from "./tools/get_code_lens";
import { get_selection_range } from "./tools/get_selection_range";
import { get_type_definition } from "./tools/get_type_definition";
import { get_declaration } from "./tools/get_declaration";
import { get_type_hierarchy } from "./tools/get_type_hierarchy";
import { get_semantic_tokens } from "./tools/get_semantic_tokens";
import { get_call_hierarchy } from "./tools/get_call_hierarchy";
import { Log } from "./core/log";

import { zodToJsonSchema } from "zod-to-json-schema";
import type { JSONSchema7 } from "json-schema";

const log = Log.getInstance();

// All available tools
const tools: (Omit<ToolDef<any, any>, "schema"> & {
  schema: z.ZodType<any> & { shape?: Record<string, z.ZodType<any>> };
})[] = [
  find_usages,
  go_to_definition,
  find_implementations,
  get_hover_info,
  get_document_symbols,
  get_completions,
  get_signature_help,
  get_rename_locations,
  get_document_highlights,
  get_workspace_symbols,
  get_code_actions,
  get_code_lens,
  get_selection_range,
  get_type_definition,
  get_declaration,
  get_type_hierarchy,
  get_semantic_tokens,
  get_call_hierarchy,
];

// Create a map for quick tool lookup
export const toolMap = new Map<string, ToolDef<any, any>>(
  tools.map((tool) => [tool.name, tool])
);

// Generate tool definitions and descriptions
export const parsedMcpTools: ToolDefinition[] = tools.map(
  generateToolDefinition
);
export const toolsDescriptions: ToolDescription[] = parsedMcpTools.map(
  (tool) => ({
    name: tool.name,
    description: tool.description.split(".")[0], // Use first sentence as short description
  })
);

// Tool execution
export async function runTool(name: string, args: unknown) {
  const tool = toolMap.get(name);
  if (!tool) {
    log.error(`Tool "${name}" not found`);
    throw new Error(`Unknown tool: ${name}`);
  }

  log.debug(`Running tool ${name} with args: ${JSON.stringify(args)}`);
  const parsed = (tool.schema as z.Schema<any>).parse(args);

  // Validate file existence if the tool requires a text document
  if (
    parsed &&
    typeof parsed === "object" &&
    "textDocument" in parsed &&
    parsed.textDocument?.uri
  ) {
    const uri = vscode.Uri.parse(parsed.textDocument.uri);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      log.error(`File not found: ${uri.fsPath}`);
      throw new Error(`File not found: ${uri.fsPath}`);
    }
  }

  try {
    const result = await tool.run(parsed);
    log.debug(`Tool ${name} completed with result: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    log.error(
      `Tool ${name} failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  }
}

function zodSchemaToJson(schema: z.ZodTypeAny): {
  type: "object";
  properties: Record<string, any>;
  required: string[];
} {
  const json = zodToJsonSchema(schema, { target: "openAi" }) as any;
  // zod-to-json-schema returns a full OpenAPI schema object.
  // We only want the "properties/required" bit:
  if (json.type !== "object") {
    throw new Error("root must be an object");
  }
  return {
    type: "object",
    properties: json.properties ?? {},
    required: (json.required ?? []) as string[],
  };
}

export function generateToolDefinition<TArgs extends z.ZodRawShape, TResult>(
  tool: Omit<ToolDef<z.infer<z.ZodType<TArgs>>, TResult>, "schema"> & {
    schema: z.ZodType<TArgs> & { shape?: Record<string, z.ZodType<any>> };
  }
): ToolDefinition {
  const json = zodSchemaToJson(tool.schema);
  return {
    name: tool.name,
    description: tool.description || "",
    inputSchema: {
      type: json.type,
      properties: json.properties,
      required: json.required,
    },
  };
}

// Debug logging to output channel
log.info("=== MCP Tools Generated ===");
log.debug(JSON.stringify(parsedMcpTools, null, 2));
log.info("=== MCP Tools Descriptions ===");
log.debug(JSON.stringify(toolsDescriptions, null, 2));
log.info("");

export type RunToolResult = Awaited<ReturnType<typeof runTool>>;
