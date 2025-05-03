import { z, ZodType as ZodSchema } from "zod";

export interface ToolDef<TArgs = any, TResult = any> {
  id: string; // same as the switch-case name
  description: string; // human-readable description of the tool's purpose
  schema: ZodSchema<TArgs>; // zod input validator
  run(args: TArgs): Promise<TResult>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
}

export interface ToolDescription {
  name: string;
  description: string;
}

// Common schemas
export const textDocumentSchema = z
  .object({
    uri: z
      .string()
      .describe("URI of the document (file:///path/to/file format)"),
  })
  .describe("The document containing the symbol");

export const positionSchema = z
  .object({
    line: z.number().describe("One-based line number"),
    character: z.number().describe("One-based character position"),
  })
  .describe("The position of the symbol in the document");

export const rangeSchema = z
  .object({
    start: positionSchema,
    end: positionSchema,
  })
  .describe("A range in a text document");

export const locationSchema = z
  .object({
    uri: z.string().describe("URI of the location"),
    range: rangeSchema,
  })
  .describe("A location in a text document");

export const locationLinkSchema = z
  .object({
    originSelectionRange: rangeSchema.optional(),
    targetUri: z.string().describe("URI of the target location"),
    targetRange: rangeSchema,
    targetSelectionRange: rangeSchema,
  })
  .describe("A link between a source and a target location");

export const symbolKindSchema = z.enum([
  "File",
  "Module",
  "Namespace",
  "Package",
  "Class",
  "Method",
  "Property",
  "Field",
  "Constructor",
  "Enum",
  "Interface",
  "Function",
  "Variable",
  "Constant",
  "String",
  "Number",
  "Boolean",
  "Array",
  "Object",
  "Key",
  "Null",
  "EnumMember",
  "Struct",
  "Event",
  "Operator",
  "TypeParameter",
]);