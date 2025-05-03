import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { textDocumentSchema, positionSchema } from "../types/tools";
import { toVscodePosition, toRange } from "../utils/converters";

type GetSelectionRangeArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
};

type SelectionRange = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  parent?: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
};

type GetSelectionRangeResult = SelectionRange[];

export const get_selection_range: ToolDef<
  GetSelectionRangeArgs,
  GetSelectionRangeResult
> = {
  name: "get_selection_range",
  description:
    "Gets selection ranges for a position in a document for smart, structure-aware expansions.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
  }),
  async run({ textDocument, position }: GetSelectionRangeArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const pos = toVscodePosition(position.line, position.character);
    const selectionRanges = await vscode.commands.executeCommand<
      vscode.SelectionRange[]
    >("vscode.executeSelectionRangeProvider", uri, [pos]);
    if (selectionRanges) {
      return selectionRanges.map((range) => ({
        range: toRange(range.range),
        parent: range.parent
          ? {
              range: toRange(range.parent.range),
            }
          : undefined,
      }));
    }
    return [];
  },
};
