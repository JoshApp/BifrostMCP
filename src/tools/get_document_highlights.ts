import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import {
  textDocumentSchema,
  positionSchema,
  rangeSchema,
} from "../types/tools";
import { toVscodePosition, toRange } from "../utils/converters";

type GetDocumentHighlightsArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
};

type GetDocumentHighlightsResult = {
  range: z.infer<typeof rangeSchema>;
  kind: vscode.DocumentHighlightKind;
}[];

export const get_document_highlights: ToolDef<
  GetDocumentHighlightsArgs,
  GetDocumentHighlightsResult
> = {
  name: "get_document_highlights",
  description: "Finds all highlights of a symbol within the current document.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
  }),
  async run({ textDocument, position }: GetDocumentHighlightsArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const pos = toVscodePosition(position.line, position.character);
    const highlights = await vscode.commands.executeCommand<
      vscode.DocumentHighlight[]
    >("vscode.executeDocumentHighlights", uri, pos);
    if (highlights) {
      return highlights.map((highlight) => ({
        range: toRange(highlight.range),
        kind: highlight.kind ?? vscode.DocumentHighlightKind.Text,
      }));
    }
    return [];
  },
};
