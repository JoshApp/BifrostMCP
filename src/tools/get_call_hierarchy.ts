import * as vscode from "vscode";
import { z } from "zod";
import { ToolDef } from "../types/tools";
import { textDocumentSchema, positionSchema } from "../types/tools";
import { toVscodePosition, toRange } from "../utils/converters";

type GetCallHierarchyArgs = {
  textDocument: z.infer<typeof textDocumentSchema>;
  position: z.infer<typeof positionSchema>;
};

type CallHierarchyItem = {
  name: string;
  kind: vscode.SymbolKind;
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  selectionRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

type CallHierarchyIncomingCall = {
  from: CallHierarchyItem;
  fromRanges: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  }[];
};

type CallHierarchyOutgoingCall = {
  to: CallHierarchyItem;
  fromRanges: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  }[];
};

type GetCallHierarchyResult = {
  item: CallHierarchyItem;
  incomingCalls: CallHierarchyIncomingCall[];
  outgoingCalls: CallHierarchyOutgoingCall[];
} | null;

async function getCallHierarchyItem(uri: vscode.Uri, pos: vscode.Position) {
  const callHierarchy = await vscode.commands.executeCommand<
    vscode.CallHierarchyItem[]
  >("vscode.prepareCallHierarchy", uri, pos);
  return callHierarchy?.[0];
}

export function toCallHierarchyItem(item: vscode.CallHierarchyItem) {
  return {
    name: item.name,
    kind: item.kind,
    uri: item.uri.toString(),
    range: toRange(item.range),
    selectionRange: toRange(item.selectionRange),
  };
}

export function toCallHierarchyIncomingCall(
  call: vscode.CallHierarchyIncomingCall
) {
  return {
    from: toCallHierarchyItem(call.from),
    fromRanges: call.fromRanges.map(toRange),
  };
}

export function toCallHierarchyOutgoingCall(
  call: vscode.CallHierarchyOutgoingCall
) {
  return {
    to: toCallHierarchyItem(call.to),
    fromRanges: call.fromRanges.map(toRange),
  };
}

export function toTypeHierarchyItem(item: vscode.TypeHierarchyItem) {
  return {
    name: item.name,
    kind: item.kind,
    uri: item.uri.toString(),
    range: toRange(item.range),
  };
}

async function getIncomingCalls(item: vscode.CallHierarchyItem) {
  const incomingCalls = await vscode.commands.executeCommand<
    vscode.CallHierarchyIncomingCall[]
  >("vscode.provideIncomingCalls", item);
  return incomingCalls?.map(toCallHierarchyIncomingCall) || [];
}

async function getOutgoingCalls(item: vscode.CallHierarchyItem) {
  const outgoingCalls = await vscode.commands.executeCommand<
    vscode.CallHierarchyOutgoingCall[]
  >("vscode.provideOutgoingCalls", item);
  return outgoingCalls?.map(toCallHierarchyOutgoingCall) || [];
}

export const get_call_hierarchy: ToolDef<
  GetCallHierarchyArgs,
  GetCallHierarchyResult
> = {
  name: "get_call_hierarchy",
  description:
    "Analyzes and visualizes the call relationships between functions and methods in the codebase.",
  schema: z.object({
    textDocument: textDocumentSchema,
    position: positionSchema,
  }),
  async run({ textDocument, position }: GetCallHierarchyArgs) {
    const uri = vscode.Uri.parse(textDocument.uri);
    const pos = toVscodePosition(position.line, position.character);

    const item = await getCallHierarchyItem(uri, pos);
    if (!item) {
      return null;
    }

    const [incomingCalls, outgoingCalls] = await Promise.all([
      getIncomingCalls(item),
      getOutgoingCalls(item),
    ]);

    return {
      item: toCallHierarchyItem(item),
      incomingCalls,
      outgoingCalls,
    };
  },
};
