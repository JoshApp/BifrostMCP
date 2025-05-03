import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { textDocumentSchema } from "../types/tools";
import { toSymbol } from "../utils/converters";

type GetDocumentSymbolsArgs = {
    textDocument: z.infer<typeof textDocumentSchema>;
};

type WorkspaceSymbol = {
    name: string;
    kind: vscode.SymbolKind;
    location: {
        uri: string;
        range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        };
    };
    containerName?: string;
};

type DocumentSymbol = {
    name: string;
    detail: string;
    kind: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    selectionRange: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    children: DocumentSymbol[];
};

type GetDocumentSymbolsResult = (WorkspaceSymbol | DocumentSymbol)[];

export const get_document_symbols: ToolDef<GetDocumentSymbolsArgs, GetDocumentSymbolsResult> = {
    id: "get_document_symbols",
    description: "Analyzes and returns a hierarchical list of all symbols defined within a document.",
    schema: z.object({
        textDocument: textDocumentSchema
    }),
    async run({ textDocument }: GetDocumentSymbolsArgs) {
        const uri = vscode.Uri.parse(textDocument.uri);
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            uri
        );
        if (symbols) {
            return symbols.map(toSymbol);
        }
        return [];
    }
}; 