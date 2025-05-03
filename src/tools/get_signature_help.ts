import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { textDocumentSchema, positionSchema } from "../types/tools";
import { toVscodePosition } from "../utils/converters";

type GetSignatureHelpArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
};

type GetSignatureHelpResult = {
  label: string;
  documentation?: string;
  parameters: {
    label: string | [number, number];
    documentation?: string;
  }[];
  activeSignature?: number;
  activeParameter?: number;
} | null;

export function toSignatureHelp(signatureHelp: vscode.SignatureHelp) {
  return signatureHelp.signatures.map((sig) => ({
    label: sig.label,
    documentation:
      typeof sig.documentation === "string"
        ? sig.documentation
        : sig.documentation?.value,
    parameters: sig.parameters.map((param) => ({
      label: param.label,
      documentation:
        typeof param.documentation === "string"
          ? param.documentation
          : param.documentation?.value,
    })),
    activeParameter: signatureHelp.activeParameter,
    activeSignature: signatureHelp.activeSignature,
  }));
}

export const get_signature_help: ToolDef<
  GetSignatureHelpArgs,
  GetSignatureHelpResult[]
> = {
  name: "get_signature_help",
  description:
    "Provides detailed information about function signatures as you type function calls.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
  }),
  async run({ textDocument, position }: GetSignatureHelpArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const pos = toVscodePosition(position.line, position.character);
    const signatureHelp =
      await vscode.commands.executeCommand<vscode.SignatureHelp>(
        "vscode.executeSignatureHelpProvider",
        uri,
        pos
      );
    if (signatureHelp) {
      return toSignatureHelp(signatureHelp);
    }
    return [];
  },
};
