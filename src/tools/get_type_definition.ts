import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import {
  textDocumentSchema,
  positionSchema,
  locationSchema,
  locationLinkSchema,
} from "../types/tools";
import {
  toVscodePosition,
  toLocation,
  toLocationLink,
} from "../utils/converters";

type GetTypeDefinitionArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
};

type GetTypeDefinitionResult = (
  | z.infer<typeof locationSchema>
  | z.infer<typeof locationLinkSchema>
)[];

export const get_type_definition: ToolDef<
  GetTypeDefinitionArgs,
  GetTypeDefinitionResult
> = {
  name: "get_type_definition",
  description: "Finds type definitions of a symbol at a specified location.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
  }),
  async run({ textDocument, position }: GetTypeDefinitionArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const pos = toVscodePosition(position.line, position.character);
    const typeDefinitions = await vscode.commands.executeCommand<
      vscode.Location[] | vscode.LocationLink[]
    >("vscode.executeTypeDefinitionProvider", uri, pos);
    if (typeDefinitions) {
      return typeDefinitions.map((loc) => {
        if ("targetUri" in loc) {
          return toLocationLink(loc);
        } else {
          return toLocation(loc);
        }
      });
    }
    return [];
  },
};
