import * as vscode from "vscode";
import { z } from "zod";
import { textDocumentSchema } from "../types/tools";
import { toRange, getPreview } from "../utils/converters";
import { ToolDef } from "../types/tools";
type GetCodeLensArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
};

type CodeLensCommand = {
  title: string;
  command: string;
  arguments?: any[];
};

type CodeLensItem = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  command?: CodeLensCommand;
  preview: string;
};

type GetCodeLensResult =
  | CodeLensItem[]
  | {
      content: { type: "text"; text: string }[];
      isError: boolean;
    };

async function convertCodeLens(
  lens: vscode.CodeLens,
  uri: vscode.Uri
): Promise<CodeLensItem> {
  return {
    range: toRange(lens.range),
    command: lens.command
      ? {
          title: lens.command.title,
          command: lens.command.command,
          arguments: lens.command.arguments,
        }
      : undefined,
    preview: await getPreview(uri, lens.range.start.line),
  };
}

export const get_code_lens: ToolDef<GetCodeLensArgs, GetCodeLensResult> = {
  name: "get_code_lens",
  description:
    "Gets CodeLens information for a document, showing actionable contextual information inline with code.",
  schema: z.object({
    textDocument: textDocumentSchema,
  }),
  async run({ textDocument }: GetCodeLensArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    try {
      const codeLensResult = await vscode.commands.executeCommand<
        vscode.CodeLens[]
      >("vscode.executeCodeLensProvider", uri);

      if (!codeLensResult || codeLensResult.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No CodeLens items found in document",
            },
          ],
          isError: false,
        };
      }

      return Promise.all(
        codeLensResult.map((lens) => convertCodeLens(lens, uri))
      );
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error executing CodeLens provider: ${error}`,
          },
        ],
        isError: true,
      };
    }
  },
};
