import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { textDocumentSchema, positionSchema, locationSchema } from "../types/tools";
import { toVscodePosition, toLocation, getPreview } from "../utils/converters";

type FindImplementationsArgs = {
    textDocument: z.infer<typeof textDocumentSchema>;
    position: z.infer<typeof positionSchema>;
};

type FindImplementationsResult = z.infer<typeof locationSchema>[];

export const find_implementations: ToolDef<FindImplementationsArgs, FindImplementationsResult> = {
    id: "find_implementations",
    description: "Discovers all concrete implementations of an interface, abstract class, or abstract method in the codebase.",
    schema: z.object({
        textDocument: textDocumentSchema,
        position: positionSchema
    }),
    async run({ textDocument, position }: FindImplementationsArgs) {
        const uri = vscode.Uri.parse(textDocument.uri);
        const pos = toVscodePosition(position.line, position.character);
        const implementations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeImplementationProvider',
            uri,
            pos
        );
        if (implementations) {
            return Promise.all(implementations.map(async (loc) => ({
                ...toLocation(loc),
                preview: await getPreview(loc.uri, loc.range.start.line)
            })));
        }
        return [];
    }
}; 