import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import {
  textDocumentSchema,
  positionSchema,
  locationSchema,
} from "../types/tools";
import { toVscodePosition, toLocation, getPreview } from "../utils/converters";

type FindUsagesArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
};

type FindUsagesResult = z.infer<typeof locationSchema>[];

export const find_usages: ToolDef<FindUsagesArgs, FindUsagesResult> = {
  name: "find_usages",
  description:
    "Finds all references to a symbol at a specified location in code.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
  }),
  async run({ textDocument, position }: FindUsagesArgs) {
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      vscode.Uri.parse(textDocument.uri),
      toVscodePosition(position.line, position.character)
    );

    return Promise.all(
      locations.map(async (loc) => ({
        ...toLocation(loc),
        preview: await getPreview(loc.uri, loc.range.start.line),
      }))
    );
  },
};
