import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { textDocumentSchema, positionSchema } from "../types/tools";
import { toVscodePosition } from "../utils/converters";

type GetCompletionsArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
};

type CompletionItem = {
  label: string | vscode.CompletionItemLabel;
  kind?: vscode.CompletionItemKind;
  detail?: string;
  documentation?: string;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  commitCharacters?: string[];
};

type GetCompletionsResult = CompletionItem[];

export function toCompletionItem(item: vscode.CompletionItem) {
  return {
    label: item.label,
    kind: item.kind,
    detail: item.detail,
    documentation:
      typeof item.documentation === "string"
        ? item.documentation
        : item.documentation?.value,
    sortText: item.sortText,
    filterText: item.filterText,
    insertText:
      typeof item.insertText === "string"
        ? item.insertText
        : item.insertText?.value,
    commitCharacters: item.commitCharacters,
  };
}

export const get_completions: ToolDef<
  GetCompletionsArgs,
  GetCompletionsResult
> = {
  id: "get_completions",
  description: "Provides intelligent code-completion suggestions based on the current context and cursor position.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
  }),
  async run({ textDocument, position }: GetCompletionsArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const pos = toVscodePosition(position.line, position.character);
    const completions =
      await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        uri,
        pos
      );
    if (completions) {
      return completions.items.map(toCompletionItem);
    }
    return [];
  },
};
