import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { textDocumentSchema, positionSchema } from "../types/tools";
import { toVscodePosition, toRange } from "../utils/converters";

type GetCodeActionsArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
};

type CodeAction = {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  diagnostics?: {
    message: string;
    severity: vscode.DiagnosticSeverity;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  }[];
};

type GetCodeActionsResult = CodeAction[];

export function toCodeAction(action: vscode.CodeAction) {
  return {
    title: action.title,
    kind: action.kind?.value,
    isPreferred: action.isPreferred,
    diagnostics: action.diagnostics?.map((diag) => ({
      message: diag.message,
      severity: diag.severity,
      range: toRange(diag.range),
    })),
  };
}

export const get_code_actions: ToolDef<
  GetCodeActionsArgs,
  GetCodeActionsResult
> = {
  name: "get_code_actions",
  description:
    "Provides context-aware code actions and refactoring suggestions at a specified location.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
  }),
  async run({ textDocument, position }: GetCodeActionsArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const pos = toVscodePosition(position.line, position.character);
    const range = pos ? new vscode.Range(pos, pos) : undefined;
    const codeActions = await vscode.commands.executeCommand<
      vscode.CodeAction[]
    >("vscode.executeCodeActionProvider", uri, range);
    if (codeActions) {
      return codeActions.map(toCodeAction);
    }
    return [];
  },
};
