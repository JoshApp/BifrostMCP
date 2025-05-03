import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { textDocumentSchema } from "../types/tools";

export const SEMANTIC_TOKEN_TYPES = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
] as const;

const tokenTypes = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
] as string[];

type TokenType = (typeof tokenTypes)[number];

const tokenModifiers = [
  "declaration",
  "definition",
  "readonly",
  "static",
  "deprecated",
  "abstract",
  "async",
  "modification",
  "documentation",
  "defaultLibrary",
] as const;
type TokenModifier = (typeof tokenModifiers)[number];

export interface ReadableToken {
  line: number;
  startCharacter: number;
  length: number;
  tokenType: TokenType | "unknown";
  modifiers: TokenModifier[];
  text: string;
}

type GetSemanticTokensArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
};

type SemanticToken = {
  line: number;
  startCharacter: number;
  length: number;
  tokenType: TokenType | "unknown";
  modifiers: string[];
  text: string;
};

type GetSemanticTokensResult = {
  tokens: SemanticToken[];
  error?: {
    content: { type: string; text: string }[];
    isError: boolean;
  };
};

async function checkSemanticTokensSupport(uri: vscode.Uri) {
  const providers = await vscode.languages.getLanguages();
  const document = await vscode.workspace.openTextDocument(uri);
  const hasSemanticTokens = providers.includes(document.languageId);

  if (!hasSemanticTokens) {
    return {
      supported: false,
      error: {
        content: [
          {
            type: "text",
            text: `Semantic tokens not supported for language: ${document.languageId}`,
          },
        ],
        isError: true,
      },
    };
  }
  return { supported: true, document };
}

async function getSemanticTokens(
  uri: vscode.Uri,
  document: vscode.TextDocument
) {
  const semanticTokens = await vscode.commands.executeCommand<
    vscode.SemanticTokens | undefined
  >("vscode.provideDocumentSemanticTokens", uri);

  if (!semanticTokens) {
    return {
      success: false,
      error: {
        content: [
          {
            type: "text",
            text: "No semantic tokens found in document",
          },
        ],
        isError: false,
      },
    };
  }

  return { success: true, semanticTokens };
}

async function getFallbackSymbols(uri: vscode.Uri): Promise<SemanticToken[]> {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    "vscode.executeDocumentSymbolProvider",
    uri
  );
  if (!symbols) {
    return [];
  }
  return symbols.map((symbol) => {
    const range = symbol.range;
    return {
      line: range.start.line,
      startCharacter: range.start.character,
      length: range.end.character - range.start.character,
      tokenType: (symbol.kind < tokenTypes.length
        ? tokenTypes[symbol.kind]
        : "unknown") as unknown as TokenType | "unknown",
      modifiers: [],
      text: symbol.name,
    } as SemanticToken;
  });
}

export function convertSemanticTokens(
  semanticTokens: vscode.SemanticTokens,
  document: vscode.TextDocument
): ReadableToken[] {
  const tokens: ReadableToken[] = [];
  let prevLine = 0;
  let prevChar = 0;

  // Process tokens in groups of 5 (format: deltaLine, deltaStartChar, length, tokenType, tokenModifiers)
  for (let i = 0; i < semanticTokens.data.length; i += 5) {
    const deltaLine = semanticTokens.data[i];
    const deltaStartChar = semanticTokens.data[i + 1];
    const length = semanticTokens.data[i + 2];
    const tokenType = semanticTokens.data[i + 3];
    const tokenModifiersBitset = semanticTokens.data[i + 4];

    // Calculate absolute position
    const line = prevLine + deltaLine;
    const startCharacter =
      deltaLine === 0 ? prevChar + deltaStartChar : deltaStartChar;

    // Get the token text
    const lineText = document.lineAt(line).text;
    const text = lineText.substring(startCharacter, startCharacter + length);

    // Convert token type and modifiers
    const type = tokenTypes[tokenType] || "unknown";
    const modifiers: TokenModifier[] = [];
    for (let j = 0; j < tokenModifiers.length; j++) {
      if (tokenModifiersBitset & (1 << j)) {
        modifiers.push(tokenModifiers[j]);
      }
    }

    tokens.push({
      line,
      startCharacter,
      length,
      tokenType: type,
      modifiers,
      text,
    });

    prevLine = line;
    prevChar = startCharacter;
  }

  return tokens;
}

export const get_semantic_tokens: ToolDef<
  GetSemanticTokensArgs,
  GetSemanticTokensResult
> = {
  name: "get_semantic_tokens",
  description:
    "Provides detailed semantic-token information for enhanced code understanding and highlighting.",
  schema: z.object({
    textDocument: textDocumentSchema,
  }),
  async run({ textDocument }: GetSemanticTokensArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const { supported, document, error } = await checkSemanticTokensSupport(
      uri
    );

    if (!supported || !document) {
      return { tokens: [], error };
    }

    const {
      success,
      semanticTokens,
      error: tokenError,
    } = await getSemanticTokens(uri, document);

    if (!success || !semanticTokens) {
      return { tokens: [], error: tokenError };
    }

    const tokens = convertSemanticTokens(semanticTokens, document);
    if (tokens.length === 0) {
      const fallbackSymbols = await getFallbackSymbols(uri);
      return { tokens: fallbackSymbols };
    }

    return { tokens };
  },
};
