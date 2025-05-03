import * as vscode from "vscode";
import { z } from "zod";
import { locationLinkSchema, ToolDef } from "../types/tools";
import { textDocumentSchema, positionSchema } from "../types/tools";
import { toVscodePosition, toLocationLink } from "../utils/converters";

type GoToDefinitionArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
};

type GoToDefinitionResult = z.infer<typeof locationLinkSchema> | null;

export const go_to_definition: ToolDef<
  GoToDefinitionArgs,
  GoToDefinitionResult
> = {
  name: "go_to_definition",
  description:
    "Navigates to the original definition of a symbol at a specified location in code.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
  }),
  async run({ textDocument, position }: GoToDefinitionArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const pos = toVscodePosition(position.line, position.character);
    const definition = await vscode.commands.executeCommand<
      vscode.LocationLink[]
    >("vscode.executeDefinitionProvider", uri, pos);
    if (definition && definition.length > 0) {
      return toLocationLink(definition[0]);
    }
    return null;
  },
};
