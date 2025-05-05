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

// Cross-platform timing function
const now = globalThis.performance?.now?.bind(globalThis.performance) ?? Date.now;

// Define the return type for runTool
export interface ToolResult<T> {
  result: T;
  metrics: {
    duration: number;
    tool: string;
  };
}

interface TextDocumentArgs {
  textDocument: {
    uri: string;
  };
}

// Tool execution
export async function runTool<TArgs, TResult>(
  name: string,
  args: unknown
): Promise<ToolResult<TResult>> {
  const startTime = now();
  try {
    const tool = toolMap.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }

    log.debug(`Running tool ${name} with args: ${JSON.stringify(args)}`);
    const parsed = (tool.schema as z.Schema<TArgs>).parse(args);

    // Validate file existence if the tool requires a text document
    if (
      parsed &&
      typeof parsed === "object" &&
      "textDocument" in parsed &&
      (parsed as TextDocumentArgs).textDocument?.uri
    ) {
      const uri = vscode.Uri.parse((parsed as TextDocumentArgs).textDocument.uri);
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        log.error(`File not found: ${uri.fsPath}`);
        throw new Error(`File not found: ${uri.fsPath}`);
      }
    }

    const result = await tool.run(parsed);
    const duration = now() - startTime;

    // Log performance metrics
    log.info(`Tool "${name}" completed in ${duration.toFixed(2)}ms`);
    log.debug(`Tool ${name} completed with result: ${JSON.stringify(result)}`);

    // Return result with performance metrics
    return {
      result,
      metrics: {
        duration,
        tool: name,
      },
    };
  } catch (error) {
    const duration = now() - startTime;
    log.error(
      `Tool "${name}" failed after ${duration.toFixed(2)}ms: ${
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

export interface ToolUiDescriptor {
  id: string;               // "get_hover_info"
  label: string;            // human readable, start case
  description: string;
  inputs: {
    key: string;            // "textDocument.uri" or "line"
    type: "uri" | "number" | "string" | "textarea";
    required: boolean;
    placeholder?: string;
    label: string;
  }[];
}

function unwrap(s: z.ZodTypeAny): z.ZodTypeAny {
  return s.isOptional() || s.isNullable() ? (s as any)._def.innerType : s;
}

function gather(shape: z.ZodRawShape, prefix = ''): ToolUiDescriptor['inputs'] {
  return Object.entries(shape).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    const inner = unwrap(v);
    if (inner instanceof z.ZodObject) {
      return gather(inner.shape, key);
    }
    return [{
      key,
      type: determineInputType(inner),
      required: !v.isOptional(),
      placeholder: getPlaceholder(key),
      label: key.split('.').pop()?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || key
    }];
  });
}

export function getToolUiDescriptors(): ToolUiDescriptor[] {
  return tools.map(tool => {
    const base = tool.schema instanceof z.ZodObject ? tool.schema : undefined;
    const inputs = base ? gather(base.shape) : [];

    return {
      id: tool.name,
      label: tool.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: tool.description.split('.')[0],
      inputs
    };
  });
}

function determineInputType(schema: z.ZodType<any>): "uri" | "number" | "string" | "textarea" {
  if (schema instanceof z.ZodString) {
    // Check for URI patterns in the key or description
    const key = (schema as any)._def?.description || '';
    if (key.toLowerCase().includes('uri') || key.endsWith('.uri')) {
      return 'uri';
    }
    return 'string';
  }
  if (schema instanceof z.ZodNumber) {
    return 'number';
  }
  if (schema instanceof z.ZodEnum) {
    return 'string'; // TODO: Could be enhanced to support dropdowns
  }
  return 'textarea';
}

function getPlaceholder(key: string): string {
  if (key.endsWith('.uri')) {
    return 'Start typing to search files...';
  }
  if (key === 'line') {
    return 'Line number';
  }
  if (key === 'character') {
    return 'Character';
  }
  if (key === 'newName') {
    return 'New name';
  }
  if (key === 'query') {
    return 'Search symbols...';
  }
  if (key === 'triggerCharacter') {
    return 'Trigger character';
  }
  if (key.includes('number') || key.includes('line') || key.includes('character')) {
    return 'Enter a number';
  }
  return 'Enter text';
}
