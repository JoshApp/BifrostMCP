import { BifrostServerManager } from '../BifrostServerManager';
import * as vscode from 'vscode';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { jest, expect, describe, it, beforeEach, afterEach } from '@jest/globals';
import { BifrostConfig } from '../core/config';

// Mock vscode
jest.mock('vscode', () => ({
    window: {
        createOutputChannel: jest.fn().mockReturnValue({
            appendLine: jest.fn(),
            dispose: jest.fn()
        })
    },
    workspace: {
        workspaceFolders: [{
            uri: {
                fsPath: '/test/path'
            }
        }],
        createFileSystemWatcher: jest.fn().mockReturnValue({
            onDidChange: jest.fn(),
            dispose: jest.fn()
        })
    },
    ExtensionContext: jest.fn(),
    ExtensionMode: {
        Production: 1
    }
}));

// Mock express
jest.mock('express', () => {
    const mockApp = {
        use: jest.fn(),
        listen: jest.fn().mockReturnValue({
            close: jest.fn()
        })
    };
    return jest.fn(() => mockApp);
});

// Mock MCP Server
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
    Server: jest.fn().mockImplementation(() => ({
        close: jest.fn(),
        setRequestHandler: jest.fn(),
        connect: jest.fn()
    }))
}));

describe('BifrostServerManager', () => {
    let manager: BifrostServerManager;
    let mockContext: vscode.ExtensionContext;
    let mockConfig: BifrostConfig;

    beforeEach(() => {
        mockContext = {
            subscriptions: [],
            workspaceState: {} as vscode.Memento,
            globalState: {} as vscode.Memento,
            secrets: {} as vscode.SecretStorage,
            extensionUri: vscode.Uri.parse('file:///test/path'),
            extensionPath: '/test/path',
            environmentVariableCollection: {} as vscode.EnvironmentVariableCollection,
            storageUri: vscode.Uri.parse('file:///test/path'),
            storagePath: '/test/path',
            logUri: vscode.Uri.parse('file:///test/path'),
            logPath: '/test/path',
            extensionMode: 1,
            extension: {} as vscode.Extension<any>,
            isNewInstall: false,
            asAbsolutePath: jest.fn(),
            globalStorageUri: vscode.Uri.parse('file:///test/path'),
            globalStoragePath: '/test/path',
            languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation
        } as unknown as vscode.ExtensionContext;

        mockConfig = {
            projectName: 'test-project',
            description: 'test description',
            path: '/test',
            port: 3000
        };

        manager = BifrostServerManager.getInstance(mockContext);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('start', () => {
        it('should create and start an express server', async () => {
            await manager.start(mockConfig);

            // Verify express app was created and configured
            expect(express).toHaveBeenCalled();
            const app = ((express as unknown) as jest.Mock<() => { use: jest.Mock; listen: jest.Mock }>)();
            expect(app.use).toHaveBeenCalledTimes(2); // cors and json middleware

            // Verify server was started on correct port
            expect(app.listen).toHaveBeenCalledWith(3000);
        });

        it('should create and configure MCP server', async () => {
            await manager.start(mockConfig);

            // Verify MCP server was created with correct config
            expect(Server).toHaveBeenCalledWith(
                {
                    name: 'test-project',
                    version: '0.1.0',
                    description: 'test description'
                },
                {
                    capabilities: {
                        tools: {},
                        resources: {}
                    }
                }
            );
        });
    });

    describe('stop', () => {
        it('should close http and mcp servers', async () => {
            // Start the server first
            await manager.start(mockConfig);
            const app = ((express as unknown) as jest.Mock<() => { use: jest.Mock; listen: jest.Mock }>)();
            const mockHttpServer = app.listen() as { close: jest.Mock };
            const mockMcpServer = ((Server as unknown) as jest.Mock<() => { close: jest.Mock }>)();

            // Stop the server
            await manager.stop();

            // Verify servers were closed
            expect(mockHttpServer.close).toHaveBeenCalled();
            expect(mockMcpServer.close).toHaveBeenCalled();
        });

        it('should clean up config watcher', async () => {
            // Start the server first
            await manager.start(mockConfig);
            const mockWatcher = { dispose: jest.fn() };
            (vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue(mockWatcher);

            // Stop the server
            await manager.stop();

            // Verify watcher was disposed
            expect(mockWatcher.dispose).toHaveBeenCalled();
        });
    });
}); 