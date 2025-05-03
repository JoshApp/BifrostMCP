(function () {
  const vscode = acquireVsCodeApi();
  let workspaceFiles = [];

  // Message handler
  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "toolDescriptors":
        renderTools(message.tools);
        break;
      case "files":
        workspaceFiles = message.files;
        updateAutocompleteLists();
        break;
      case "currentFile":
        handleCurrentFile(message);
        break;
      case "result":
        handleResult(message);
        break;
    }
  });

  // Tool rendering
  function renderTools(tools) {
    const container = document.getElementById("tools");
    container.innerHTML = tools.map((t) => toolCard(t)).join("");
    setupEventHandlers();
  }

  function toolCard(t) {
    return /*html*/`
      <section class="tool" id="tool-${t.id}">
        <h3>${t.label}</h3>
        <p>${t.description}</p>
        ${t.inputs.map((i) => inputHtml(i, t.id)).join("")}
        <button data-tool="${t.id}">Execute</button>
        <pre id="result-${t.id}">Results will appear here...</pre>
      </section>`;
  }

  function inputHtml(input, toolId) {
    const commonAttrs = `data-key="${
      input.key
    }" data-tool="${toolId}" placeholder="${input.placeholder || ""}"`;

    switch (input.type) {
      case "uri":
        return `
          <div class="input-group">
            <label for="input-${toolId}-${input.key}">${input.label}</label>
            <div class="autocomplete">
              <input type="text" id="input-${toolId}-${input.key}" ${commonAttrs}>
              <button class="current-file-button" data-action="use-current-file">Use Current File</button>
              <div class="autocomplete-list"></div>
            </div>
          </div>`;
      case "number":
        return `
          <div class="input-group">
            <label for="input-${toolId}-${input.key}">${input.label}</label>
            <input type="number" id="input-${toolId}-${input.key}" ${commonAttrs}>
          </div>`;
      case "string":
        return `
          <div class="input-group">
            <label for="input-${toolId}-${input.key}">${input.label}</label>
            <input type="text" id="input-${toolId}-${input.key}" ${commonAttrs}>
          </div>`;
      case "textarea":
        return `
          <div class="input-group">
            <label for="input-${toolId}-${input.key}">${input.label}</label>
            <textarea id="input-${toolId}-${input.key}" ${commonAttrs}></textarea>
          </div>`;
      default:
        return `
          <div class="input-group">
            <label for="input-${toolId}-${input.key}">${input.label}</label>
            <input type="text" id="input-${toolId}-${input.key}" ${commonAttrs}>
          </div>`;
    }
  }

  // Event handling
  function setupEventHandlers() {
    const container = document.getElementById("tools");

    // Execute button handler
    container.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-tool]");
      if (!button) {
        return;
      }

      const toolId = button.dataset.tool;
      const toolSection = button.closest(".tool");
      const inputs = toolSection.querySelectorAll("[data-key]");

      const params = {};
      inputs.forEach((input) => {
        const key = input.dataset.key;
        const value = input.value;
        if (value) {
          // Handle nested keys (e.g., "textDocument.uri")
          const keys = key.split(".");
          let current = params;
          for (let i = 0; i < keys.length - 1; i++) {
            current[keys[i]] = current[keys[i]] || {};
            current = current[keys[i]];
          }
          // Convert value to appropriate type based on input type
          const inputType = input.type || input.getAttribute('type');
          let convertedValue = value;
          if (inputType === 'number') {
            convertedValue = Number(value);
          } else if (inputType === 'boolean') {
            convertedValue = value === 'true';
          }
          current[keys[keys.length - 1]] = convertedValue;
        }
      });

      vscode.postMessage({ command: "execute", tool: toolId, params });
    });

    // Current file button handler
    container.addEventListener("click", (event) => {
      const button = event.target.closest(
        "button[data-action='use-current-file']"
      );
      if (!button) {
        return;
      }

      const input = button.previousElementSibling;
      const toolId = input.dataset.tool;
      vscode.postMessage({ command: "getCurrentFile", tool: toolId });
    });

    // Setup autocomplete for URI inputs
    setupUriAutocomplete();
  }

  // Autocomplete functionality
  function setupUriAutocomplete() {
    const container = document.getElementById("tools");
    const uriInputs = container.querySelectorAll(".autocomplete input");

    uriInputs.forEach((input) => {
      let selectedIndex = -1;
      const autocompleteList = input.nextElementSibling.nextElementSibling;

      input.addEventListener("input", () => {
        const value = input.value.toLowerCase();
        const matches = workspaceFiles
          .filter((file) => file.label.toLowerCase().includes(value))
          .slice(0, 10);

        if (matches.length && value) {
          autocompleteList.innerHTML = matches
            .map(
              (file, index) => `
              <div class="autocomplete-item" data-index="${index}" data-uri="${file.uri}">
                ${file.label}
              </div>`
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
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".autocomplete")) {
        document.querySelectorAll(".autocomplete-list").forEach((list) => {
          list.style.display = "none";
        });
      }
    });
  }

  // Existing handlers
  function handleCurrentFile(message) {
    const input = document.querySelector(`input[data-tool="${message.tool}"]`);
    const resultElement = document.getElementById(`result-${message.tool}`);
    if (message.error) {
      resultElement.textContent =
        message.error + ". Please open a file in the editor first.";
      resultElement.className = "error";
      input.value = "";
    } else if (message.uri) {
      input.value = message.uri;
      resultElement.textContent = "Current file selected: " + message.uri;
      resultElement.className = "success";
    }
  }

  function handleResult(message) {
    const resultElement = document.getElementById(`result-${message.tool}`);
    if (!resultElement) {
      return;
    }

    try {
      let resultText = "";
      if (message.isError) {
        resultText =
          message.result.error || JSON.stringify(message.result, null, 2);
        resultElement.className = "error";
      } else if (message.result?.content?.[0]?.type === "text") {
        const innerContent = message.result.content[0].text;
        try {
          const parsedJson = JSON.parse(innerContent);
          resultText = JSON.stringify(parsedJson, null, 2);
        } catch {
          resultText = JSON.stringify(message.result, null, 2);
        }
        resultElement.className = "success";
      } else {
        resultText = JSON.stringify(message.result, null, 2);
        resultElement.className = "success";
      }
      resultElement.textContent = resultText;
    } catch (error) {
      resultElement.textContent = JSON.stringify(message.result, null, 2);
      resultElement.className = "error";
    }
  }

  function updateAutocompleteLists() {
    // Optionally update autocomplete UI if needed
  }
})();
