import { toolsDescriptions } from "../toolManager";

const onlyUriTools = [
  "get_semantic_tokens",
  "get_document_symbols",
  "get_code_lens",
  "get_workspace_symbols",
];
const noUriTools = ["get_workspace_symbols"];

export const webviewHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { 
                padding: 20px;
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
            }
            .tool-section {
                margin-bottom: 20px;
                padding: 10px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
            }
            .tool-title {
                font-weight: bold;
                margin-bottom: 10px;
            }
            input, button {
                margin: 5px 0;
                padding: 5px;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
            }
            button {
                cursor: pointer;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 8px 12px;
                border-radius: 2px;
            }
            button:hover {
                background: var(--vscode-button-hoverBackground);
            }
            pre {
                background: var(--vscode-textCodeBlock-background);
                padding: 10px;
                overflow-x: auto;
                margin-top: 10px;
                color: var(--vscode-foreground);
            }
            .error-message {
                color: var(--vscode-errorForeground);
            }
            .success-message {
                color: var(--vscode-terminal-ansiGreen);
            }
            .autocomplete-container {
                position: relative;
                width: 100%;
            }
            .autocomplete-list {
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                max-height: 200px;
                overflow-y: auto;
                background: var(--vscode-input-background);
                border: 1px solid var(--vscode-input-border);
                z-index: 1000;
                display: none;
            }
            .autocomplete-item {
                padding: 5px 10px;
                cursor: pointer;
            }
            .autocomplete-item:hover {
                background: var(--vscode-list-hoverBackground);
            }
            .autocomplete-item.selected {
                background: var(--vscode-list-activeSelectionBackground);
                color: var(--vscode-list-activeSelectionForeground);
            }
            .current-file-button {
                margin-left: 5px;
            }
            .tool-inputs {
                margin: 10px 0;
            }
        </style>
    </head>
    <body>
        ${toolsDescriptions
          .map(
            (tool) => `
            <div class="tool-section">
                <div class="tool-title">${tool.name}</div>
                <div>${tool.description}</div>
                ${
                  !noUriTools.includes(tool.name)
                    ? `
                <div class="autocomplete-container">
                    <div style="display: flex; align-items: center;">
                        <input type="text" id="uri-${tool.name}" class="file-input" placeholder="Start typing to search files..." style="flex: 1;">
                        <button class="current-file-button" onclick="useCurrentFile('${tool.name}')">Use Current File</button>
                    </div>
                    <div id="autocomplete-${tool.name}" class="autocomplete-list"></div>
                </div>
                `
                    : ""
                }
                <div class="tool-inputs">
                    ${
                      !onlyUriTools.includes(tool.name)
                        ? `
                        <input type="number" id="line-${tool.name}" placeholder="Line number" style="width: 100px">
                        <input type="number" id="char-${tool.name}" placeholder="Character" style="width: 100px">
                    `
                        : ""
                    }
                    ${
                      tool.name === "get_completions"
                        ? `
                        <input type="text" id="trigger-${tool.name}" placeholder="Trigger character" style="width: 50px" maxlength="1">
                    `
                        : ""
                    }
                    ${
                      tool.name === "get_rename_locations"
                        ? `
                        <input type="text" id="newname-${tool.name}" placeholder="New name" style="width: 150px">
                    `
                        : ""
                    }
                    ${
                      tool.name === "get_workspace_symbols"
                        ? `
                        <input type="text" id="query-${tool.name}" placeholder="Search symbols..." style="width: 200px">
                    `
                        : ""
                    }
                </div>
                <button onclick="executeTool('${tool.name}')">Execute</button>
                <pre id="result-${tool.name}">Results will appear here...</pre>
            </div>
        `
          )
          .join("")}
        <script>
            const vscode = acquireVsCodeApi();
            let workspaceFiles = [];
            
            // File autocomplete functionality
            function setupFileAutocomplete(toolName) {
                if (${JSON.stringify(noUriTools)}.includes(toolName)) {
                    return;
                }
                const input = document.getElementById('uri-' + toolName);
                const autocompleteList = document.getElementById('autocomplete-' + toolName);
                let selectedIndex = -1;

                input.addEventListener('input', () => {
                    const value = input.value.toLowerCase();
                    const matches = workspaceFiles.filter(file => 
                        file.toLowerCase().includes(value)
                    ).slice(0, 10);

                    if (matches.length && value) {
                        autocompleteList.innerHTML = matches
                            .map((file, index) => \`
                                <div class="autocomplete-item" data-index="\${index}">
                                    \${file}
                                </div>
                            \`).join('');
                        autocompleteList.style.display = 'block';
                    } else {
                        autocompleteList.style.display = 'none';
                    }
                    selectedIndex = -1;
                });

                input.addEventListener('keydown', (e) => {
                    const items = autocompleteList.getElementsByClassName('autocomplete-item');
                    
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                        updateSelection();
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        selectedIndex = Math.max(selectedIndex - 1, -1);
                        updateSelection();
                    } else if (e.key === 'Enter' && selectedIndex >= 0) {
                        e.preventDefault();
                        if (items[selectedIndex]) {
                            input.value = items[selectedIndex].textContent.trim();
                            autocompleteList.style.display = 'none';
                        }
                    } else if (e.key === 'Escape') {
                        autocompleteList.style.display = 'none';
                        selectedIndex = -1;
                    }
                });

                function updateSelection() {
                    const items = autocompleteList.getElementsByClassName('autocomplete-item');
                    for (let i = 0; i < items.length; i++) {
                        items[i].classList.toggle('selected', i === selectedIndex);
                    }
                    if (selectedIndex >= 0 && items[selectedIndex]) {
                        items[selectedIndex].scrollIntoView({ block: 'nearest' });
                    }
                }

                autocompleteList.addEventListener('click', (e) => {
                    const item = e.target.closest('.autocomplete-item');
                    if (item) {
                        input.value = item.textContent.trim();
                        autocompleteList.style.display = 'none';
                    }
                });

                document.addEventListener('click', (e) => {
                    if (!e.target.closest('.autocomplete-container')) {
                        autocompleteList.style.display = 'none';
                    }
                });
            }

            tools = ${JSON.stringify(toolsDescriptions)};
            tools.forEach(tool => {
                setupFileAutocomplete(tool.name);
            });

            function useCurrentFile(toolName) {
                if (${JSON.stringify(noUriTools)}.includes(toolName)) {
                    return;
                }
                vscode.postMessage({
                    command: 'getCurrentFile',
                    tool: toolName
                });
            }

            function executeTool(toolName) {
                const params = {};
                
                if (!${JSON.stringify(noUriTools)}.includes(toolName)) {
                    const uri = document.getElementById('uri-' + toolName).value;
                    params.textDocument = { uri };
                }

                if (!${JSON.stringify(onlyUriTools)}.includes(toolName)) {
                    const line = document.getElementById('line-' + toolName)?.value;
                    const char = document.getElementById('char-' + toolName)?.value;
                    params.position = {
                        line: parseInt(line),
                        character: parseInt(char)
                    };
                }

                if (toolName === 'get_completions') {
                    const trigger = document.getElementById('trigger-' + toolName)?.value;
                    if (trigger) {
                        params.triggerCharacter = trigger;
                    }
                }

                if (toolName === 'get_rename_locations') {
                    const newName = document.getElementById('newname-' + toolName)?.value;
                    if (newName) {
                        params.newName = newName;
                    }
                }

                if (toolName === 'get_workspace_symbols') {
                    const query = document.getElementById('query-' + toolName)?.value;
                    params.query = query || '';
                }

                vscode.postMessage({
                    command: 'execute',
                    tool: toolName,
                    params
                });
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.type === 'files') {
                    workspaceFiles = message.files;
                } else if (message.type === 'currentFile') {
                    const input = document.getElementById('uri-' + message.tool);
                    const resultElement = document.getElementById('result-' + message.tool);
                    if (message.error) {
                        resultElement.textContent = message.error + '. Please open a file in the editor first.';
                        resultElement.className = 'error-message';
                        input.value = '';
                    } else if (message.uri) {
                        input.value = message.uri;
                        resultElement.textContent = 'Current file selected: ' + message.uri;
                        resultElement.className = 'success-message';
                    }
                } else if (message.type === 'result') {
                    const resultElement = document.getElementById('result-' + message.tool);
                    try {
                        let resultText = '';
                        if (message.result?.content?.[0]?.type === 'text') {
                            const innerContent = message.result.content[0].text;
                            try {
                                const parsedJson = JSON.parse(innerContent);
                                resultText = JSON.stringify(parsedJson, null, 2);
                            } catch {
                                resultText = JSON.stringify(message.result, null, 2);
                            }
                        } else {
                            resultText = JSON.stringify(message.result, null, 2);
                        }
                        resultElement.textContent = resultText;
                        resultElement.className = ''; // Remove any special styling for results
                    } catch (error) {
                        resultElement.textContent = JSON.stringify(message.result, null, 2);
                        resultElement.className = ''; // Remove any special styling for results
                    }
                }
            });
        </script>
    </body>
    </html>
`;
