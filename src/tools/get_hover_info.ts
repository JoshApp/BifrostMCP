import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import {
  textDocumentSchema,
  positionSchema,
  rangeSchema,
} from "../types/tools";
import { toVscodePosition, toRange, getPreview } from "../utils/converters";

export function toHoverContent(
  content: vscode.MarkdownString | vscode.MarkedString
) {
  if (typeof content === "string") {
    return content;
  }
  if ("language" in content) {
    return content.value;
  }
  return content.value;
}

type GetHoverInfoArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
};

type GetHoverInfoResult = {
  contents: string[];
  range?: z.infer<typeof rangeSchema>;
  preview?: string;
}[];

export const get_hover_info: ToolDef<GetHoverInfoArgs, GetHoverInfoResult> = {
  name: "get_hover_info",
  description:
    "Retrieves comprehensive information about a symbol when hovering over it in code.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
  }),
  async run({ textDocument, position }: GetHoverInfoArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const pos = toVscodePosition(position.line, position.character);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      uri,
      pos
    );
    if (hovers.length > 0) {
      return Promise.all(
        hovers.map(async (hover) => ({
          contents: hover.contents.map(toHoverContent),
          range: hover.range ? toRange(hover.range) : undefined,
          preview: hover.range
            ? await getPreview(uri, hover.range.start.line)
            : undefined,
        }))
      );
    }
    return [];
  },
};
