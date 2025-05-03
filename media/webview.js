// This script is loaded with a nonce and CSP. It expects initial data to be injected or sent via postMessage.

(function () {
  // These will be injected by the extension
  let toolsDescriptions = [];
  let onlyUriTools = [];
  let noUriTools = [];

  // Listen for initial data from the extension
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "init") {
      toolsDescriptions = message.toolsDescriptions;
      onlyUriTools = message.onlyUriTools;
      noUriTools = message.noUriTools;
      renderUI();
    }
    if (message.type === "files") {
      workspaceFiles = message.files;
      updateAutocompleteLists();
    }
    if (message.type === "fileAdd") {
      if (!workspaceFiles.some(f => f.uri === message.file.uri)) {
        workspaceFiles.push(message.file);
        updateAutocompleteLists();
      }
    }
    if (message.type === "fileRemove") {
      const index = workspaceFiles.findIndex(f => f.uri === message.file.uri);
      if (index !== -1) {
        workspaceFiles.splice(index, 1);
        updateAutocompleteLists();
      }
    }
    if (message.type === "currentFile") {
      handleCurrentFile(message);
    }
    if (message.type === "result") {
      handleResult(message);
    }
  });

  // VS Code API
  const vscode = acquireVsCodeApi();
  let workspaceFiles = [];

  function renderUI() {
    const root = document.getElementById("root");
    if (!root) {
      return;
    }
    root.innerHTML = toolsDescriptions
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
            <button class="current-file-button" data-tool="${tool.name}" data-action="use-current-file">Use Current File</button>
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
        <button class="execute-button" data-tool="${tool.name}" data-action="execute">Execute</button>
        <pre id="result-${tool.name}">Results will appear here...</pre>
      </div>
    `
      )
      .join("");
    setupEventHandlers();
  }

  function setupEventHandlers() {
    // Set up event delegation for all buttons
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) {return};

      const toolName = button.dataset.tool;
      const action = button.dataset.action;

      if (!toolName || !action) {return};

      if (action === 'execute') {
        executeTool(toolName);
      } else if (action === 'use-current-file') {
        useCurrentFile(toolName);
      }
    });

    // Set up autocomplete handlers
    toolsDescriptions.forEach((tool) => {
      if (!noUriTools.includes(tool.name)) {
        setupFileAutocomplete(tool.name);
      }
    });
  }

  function setupFileAutocomplete(toolName) {
    const input = document.getElementById("uri-" + toolName);
    const autocompleteList = document.getElementById(
      "autocomplete-" + toolName
    );
    let selectedIndex = -1;
    if (!input || !autocompleteList) return;
    input.addEventListener("input", () => {
      const value = input.value.toLowerCase();
      const matches = workspaceFiles
        .filter((file) => file.label.toLowerCase().includes(value))
        .slice(0, 10);
      if (matches.length && value) {
        autocompleteList.innerHTML = matches
          .map(
            (file, index) => `
          <div class="autocomplete-item" data-index="${index}" data-uri="${file.uri}">${file.label}</div>
        `
          )
          .join("");
        autocompleteList.style.display = "block";
      } else {
        autocompleteList.style.display = "none";
      }
      selectedIndex = -1;
    });
    input.addEventListener("keydown", (e) => {
      const items =
        autocompleteList.getElementsByClassName("autocomplete-item");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelection();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelection();
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        if (items[selectedIndex]) {
          input.value = items[selectedIndex].dataset.uri;
          autocompleteList.style.display = "none";
        }
      } else if (e.key === "Escape") {
        autocompleteList.style.display = "none";
        selectedIndex = -1;
      }
    });
    function updateSelection() {
      const items =
        autocompleteList.getElementsByClassName("autocomplete-item");
      for (let i = 0; i < items.length; i++) {
        items[i].classList.toggle("selected", i === selectedIndex);
      }
      if (selectedIndex >= 0 && items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: "nearest" });
      }
    }
    autocompleteList.addEventListener("click", (e) => {
      const item = e.target.closest(".autocomplete-item");
      if (item) {
        input.value = item.dataset.uri;
        autocompleteList.style.display = "none";
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".autocomplete-container")) {
        autocompleteList.style.display = "none";
      }
    });
  }

  function useCurrentFile(toolName) {
    vscode.postMessage({ command: "getCurrentFile", tool: toolName });
  }

  function executeTool(toolName) {
    const params = {};
    if (!noUriTools.includes(toolName)) {
      const input = document.getElementById("uri-" + toolName);
      const selectedItem = input?.closest('.autocomplete-container')?.querySelector('.autocomplete-item.selected');
      const uri = selectedItem?.dataset.uri || input?.value;
      if (uri) {
        params.textDocument = { uri };
      }
    }
    if (!onlyUriTools.includes(toolName)) {
      const line = document.getElementById("line-" + toolName)?.value;
      const char = document.getElementById("char-" + toolName)?.value;
      params.position = {
        line: parseInt(line),
        character: parseInt(char),
      };
    }
    if (toolName === "get_completions") {
      const trigger = document.getElementById("trigger-" + toolName)?.value;
      if (trigger) {
        params.triggerCharacter = trigger;
      }
    }
    if (toolName === "get_rename_locations") {
      const newName = document.getElementById("newname-" + toolName)?.value;
      if (newName) {
        params.newName = newName;
      }
    }
    if (toolName === "get_workspace_symbols") {
      const query = document.getElementById("query-" + toolName)?.value;
      params.query = query || "";
    }
    vscode.postMessage({ command: "execute", tool: toolName, params });
  }

  function updateAutocompleteLists() {
    // Optionally update autocomplete UI if needed
  }

  function handleCurrentFile(message) {
    const input = document.getElementById("uri-" + message.tool);
    const resultElement = document.getElementById("result-" + message.tool);
    if (message.error) {
      resultElement.textContent =
        message.error + ". Please open a file in the editor first.";
      resultElement.className = "error-message";
      input.value = "";
    } else if (message.uri) {
      input.value = message.uri;
      resultElement.textContent = "Current file selected: " + message.uri;
      resultElement.className = "success-message";
    }
  }

  function handleResult(message) {
    const resultElement = document.getElementById("result-" + message.tool);
    if (!resultElement) return;

    try {
      let resultText = "";
      if (message.isError) {
        // For errors, just show the error message directly
        resultText = message.result.error || JSON.stringify(message.result, null, 2);
        resultElement.className = "error-message";
      } else if (message.result?.content?.[0]?.type === "text") {
        const innerContent = message.result.content[0].text;
        try {
          const parsedJson = JSON.parse(innerContent);
          resultText = JSON.stringify(parsedJson, null, 2);
        } catch {
          resultText = JSON.stringify(message.result, null, 2);
        }
        resultElement.className = "";
      } else {
        resultText = JSON.stringify(message.result, null, 2);
        resultElement.className = "";
      }
      resultElement.textContent = resultText;
    } catch (error) {
      resultElement.textContent = JSON.stringify(message.result, null, 2);
      resultElement.className = "error-message";
    }
  }
})();
