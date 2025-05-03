import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { textDocumentSchema, positionSchema } from "../types/tools";
import { toVscodePosition, toRange } from "../utils/converters";

type RenameEdit = {
  uri: string;
  edits: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newText: string;
  }[];
};

type GetRenameLocationsArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
  newName?: string;
};

type GetRenameLocationsResult = RenameEdit[];

function convertRenameEdits(renameEdits: vscode.WorkspaceEdit): RenameEdit[] {
  const entries: RenameEdit[] = [];
  for (const [editUri, edits] of renameEdits.entries()) {
    entries.push({
      uri: editUri.toString(),
      edits: edits.map((edit) => ({
        range: toRange(edit.range),
        newText: edit.newText,
      })),
    });
  }
  return entries;
}

export const get_rename_locations: ToolDef<
  GetRenameLocationsArgs,
  GetRenameLocationsResult
> = {
  name: "get_rename_locations",
  description:
    "Identifies all locations that need to be updated when renaming a symbol.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
    newName: z.string().optional(),
  }),
  async run({ textDocument, position, newName }: GetRenameLocationsArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const pos = toVscodePosition(position.line, position.character);
    const name = newName || "newName";

    const renameEdits =
      await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        "vscode.executeDocumentRenameProvider",
        uri,
        pos,
        name
      );

    return renameEdits ? convertRenameEdits(renameEdits) : [];
  },
};
