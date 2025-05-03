import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { toSymbol } from "../utils/converters";

type GetWorkspaceSymbolsArgs = {
    query: string;
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

type GetWorkspaceSymbolsResult = WorkspaceSymbol[];

export const get_workspace_symbols: ToolDef<GetWorkspaceSymbolsArgs, GetWorkspaceSymbolsResult> = {
    id: "get_workspace_symbols",
    description: "Searches for symbols across the entire workspace.",
    schema: z.object({
        query: z.string().describe("The search query to match against symbol names. Can be partial and is case-insensitive.")
    }),
    async run({ query }: GetWorkspaceSymbolsArgs) {
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider',
            query
        );
        if (symbols) {
            return symbols.map(toSymbol) as WorkspaceSymbol[];
        }
        return [];
    }
}; 