import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { textDocumentSchema, positionSchema } from "../types/tools";
import { toVscodePosition, toRange } from "../utils/converters";

type GetTypeHierarchyArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
};

type TypeHierarchyItem = {
  name: string;
  kind: vscode.SymbolKind;
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

type GetTypeHierarchyResult = {
  item: TypeHierarchyItem;
  supertypes: TypeHierarchyItem[];
  subtypes: TypeHierarchyItem[];
} | null;

async function getTypeHierarchyItem(uri: vscode.Uri, pos: vscode.Position) {
  const typeHierarchyItems = await vscode.commands.executeCommand<
    vscode.TypeHierarchyItem[]
  >("vscode.prepareTypeHierarchy", uri, pos);
  return typeHierarchyItems?.[0];
}

async function getTypeHierarchyRelations(item: vscode.TypeHierarchyItem) {
  const [supertypes, subtypes] = await Promise.all([
    vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
      "vscode.executeTypeHierarchySupertypeCommand",
      item
    ),
    vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
      "vscode.executeTypeHierarchySubtypeCommand",
      item
    ),
  ]);

  return {
    supertypes: supertypes?.map(toTypeHierarchyItem) || [],
    subtypes: subtypes?.map(toTypeHierarchyItem) || [],
  };
}

export function toTypeHierarchyItem(item: vscode.TypeHierarchyItem) {
  return {
    name: item.name,
    kind: item.kind,
    uri: item.uri.toString(),
    range: toRange(item.range),
  };
}

export const get_type_hierarchy: ToolDef<
  GetTypeHierarchyArgs,
  GetTypeHierarchyResult
> = {
  name: "get_type_hierarchy",
  description:
    "Analyzes and visualizes the inheritance and implementation relationships between types.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
  }),
  async run({ textDocument, position }: GetTypeHierarchyArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const pos = toVscodePosition(position.line, position.character);

    const item = await getTypeHierarchyItem(uri, pos);
    if (!item) {
      return null;
    }

    const { supertypes, subtypes } = await getTypeHierarchyRelations(item);

    return {
      item: toTypeHierarchyItem(item),
      supertypes,
      subtypes,
    };
  },
};
