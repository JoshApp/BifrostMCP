import * as vscode from "vscode";

export function getSymbolKindString(kind: vscode.SymbolKind): string {
  return vscode.SymbolKind[kind];
}

export async function getPreview(
  uri: vscode.Uri,
  line: number | undefined
): Promise<string> {
  if (line === undefined) {
    return "";
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const lineText = document.lineAt(line).text.trim();
  return lineText;
}

export function toVscodePosition(
  line: number,
  character: number
): vscode.Position {
  if (!line || !character) {
    throw new Error("toPosition: line/character undefined");
  }
  return new vscode.Position(line - 1, character - 1);
}

export function toRange(range: vscode.Range) {
  return {
    start: {
      line: range.start.line + 1,
      character: range.start.character + 1,
    },
    end: {
      line: range.end.line + 1,
      character: range.end.character + 1,
    },
  };
}

export function toLocation(location: vscode.Location) {
  return {
    uri: location.uri.toString(),
    range: toRange(location.range),
  };
}

export interface WorkspaceSymbol {
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
}

export interface DocumentSymbol {
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
}

export function toSymbol(
  symbol: vscode.SymbolInformation | vscode.DocumentSymbol
): WorkspaceSymbol | DocumentSymbol {
  if (symbol instanceof vscode.SymbolInformation) {
    return {
      name: symbol.name,
      kind: symbol.kind,
      location: {
        uri: symbol.location.uri.toString(),
        range: toRange(symbol.location.range),
      },
      containerName: symbol.containerName,
    };
  } else {
    return {
      name: symbol.name,
      detail: symbol.detail,
      kind: getSymbolKindString(symbol.kind),
      range: toRange(symbol.range),
      selectionRange: toRange(symbol.selectionRange),
      children: symbol.children.map(toSymbol) as DocumentSymbol[],
    };
  }
}
export function toLocationLink(link: vscode.LocationLink) {
  return {
    targetUri: link.targetUri.toString(),
    targetRange: toRange(link.targetRange),
    targetSelectionRange: link.targetSelectionRange
      ? toRange(link.targetSelectionRange)
      : toRange(link.targetRange),
    originSelectionRange: link.originSelectionRange
      ? toRange(link.originSelectionRange)
      : undefined,
  };
}
