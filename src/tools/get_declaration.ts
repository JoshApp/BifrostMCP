import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { textDocumentSchema, positionSchema, locationSchema, locationLinkSchema } from "../types/tools";
import { toVscodePosition, toLocation, toLocationLink } from "../utils/converters";

type GetDeclarationArgs = {
    textDocument: z.infer<typeof textDocumentSchema>;
    position: z.infer<typeof positionSchema>;
};

type GetDeclarationResult = (z.infer<typeof locationSchema> | z.infer<typeof locationLinkSchema>)[];

export const get_declaration: ToolDef<GetDeclarationArgs, GetDeclarationResult> = {
    id: "get_declaration",
    description: "Finds declarations of a symbol at a specified location.",
    schema: z.object({
        textDocument: textDocumentSchema,
        position: positionSchema
    }),
    async run({ textDocument, position }: GetDeclarationArgs) {
        const uri = vscode.Uri.parse(textDocument.uri);
        const pos = toVscodePosition(position.line, position.character);
        const declarations = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
            'vscode.executeDeclarationProvider',
            uri,
            pos
        );
        if (declarations) {
            return declarations.map(loc => {
                if ('targetUri' in loc) {
                    return toLocationLink(loc);
                } else {
                    return toLocation(loc);
                }
            });
        }
        return [];
    }
}; 