(function () {
  "use strict";

  const MAX_SEARCH_RESULTS = 500;
  const state = {
    manifest: null,
    activeId: null,
    datasets: new Map(),
    searchTimer: 0,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindEvents();

    try {
      const response = await fetch("catalog/manifest.json");
      if (!response.ok) {
        throw new Error(`Unable to load manifest (${response.status})`);
      }
      state.manifest = await response.json();
      for (const dataset of state.manifest.datasets) {
        state.datasets.set(dataset.id, dataset);
      }
      renderDatasetTabs();
      const first = state.manifest.datasets[0];
      if (first) {
        await activateDataset(first.id);
      }
    } catch (error) {
      showError(error.message || String(error));
    }
  }

  function cacheElements() {
    els.datasetTabs = document.getElementById("datasetTabs");
    els.stats = document.getElementById("stats");
    els.downloadList = document.getElementById("downloadList");
    els.searchInput = document.getElementById("searchInput");
    els.clearSearch = document.getElementById("clearSearch");
    els.statusLine = document.getElementById("statusLine");
    els.searchResults = document.getElementById("searchResults");
    els.tree = document.getElementById("tree");
  }

  function bindEvents() {
    els.searchInput.addEventListener("input", function () {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(renderSearchOrTree, 160);
    });

    els.clearSearch.addEventListener("click", function () {
      els.searchInput.value = "";
      renderSearchOrTree();
      els.searchInput.focus();
    });
  }

  function renderDatasetTabs() {
    const fragment = document.createDocumentFragment();
    for (const dataset of state.manifest.datasets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dataset-tab";
      button.textContent = dataset.display_root;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", function () {
        activateDataset(dataset.id);
      });
      fragment.appendChild(button);
    }
    els.datasetTabs.replaceChildren(fragment);
  }

  async function activateDataset(datasetId) {
    state.activeId = datasetId;
    els.searchInput.value = "";
    updateActiveTab();
    renderStats();
    clearBrowser();

    const dataset = state.datasets.get(datasetId);
    if (!dataset.tree) {
      els.statusLine.textContent = `Loading ${dataset.display_root}...`;
      const response = await fetch(dataset.catalog_file);
      if (!response.ok) {
        showError(`Unable to load ${dataset.catalog_file} (${response.status})`);
        return;
      }
      const text = await response.text();
      dataset.paths = text.split(/\r?\n/).filter(Boolean);
      dataset.queries = await loadQueryChunks(dataset);
      dataset.tree = buildTree(dataset);
    }

    renderSearchOrTree();
  }

  function updateActiveTab() {
    for (const button of els.datasetTabs.querySelectorAll(".dataset-tab")) {
      button.setAttribute("aria-pressed", String(button.textContent === activeDataset().display_root));
    }
  }

  function renderStats() {
    const dataset = activeDataset();
    const sectionText = Object.entries(dataset.sections || {})
      .map(([name, count]) => `${name} ${formatNumber(count)}`)
      .join(", ");

    const rows = [
      ["Files", formatNumber(dataset.file_count)],
      ["Years", dataset.year_min && dataset.year_max ? `${dataset.year_min}-${dataset.year_max}` : "n/a"],
      ["Models", formatNumber(dataset.model_count || 0)],
      ["Sections", sectionText || "n/a"],
    ];

    const fragment = document.createDocumentFragment();
    for (const [label, value] of rows) {
      const wrapper = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      wrapper.append(dt, dd);
      fragment.appendChild(wrapper);
    }
    els.stats.replaceChildren(fragment);
    els.downloadList.href = dataset.catalog_file;
  }

  function clearBrowser() {
    els.searchResults.hidden = true;
    els.searchResults.replaceChildren();
    els.tree.replaceChildren();
  }

  function renderSearchOrTree() {
    const query = els.searchInput.value.trim();
    if (query) {
      renderSearch(query);
    } else {
      els.searchResults.hidden = true;
      els.tree.hidden = false;
      renderTree();
    }
  }

  function renderTree() {
    const dataset = activeDataset();
    els.statusLine.textContent = `${dataset.display_root} - ${formatNumber(dataset.file_count)} file links`;
    const fragment = document.createDocumentFragment();
    renderNodeChildren(dataset.tree, fragment, dataset, 0);
    els.tree.replaceChildren(fragment);
  }

  function renderSearch(query) {
    const dataset = activeDataset();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = [];

    for (let index = 0; index < (dataset.paths || []).length; index += 1) {
      const sourcePath = dataset.paths[index];
      const visiblePath = displayPath(sourcePath, dataset);
      const candidate = visiblePath.toLowerCase();
      if (terms.every((term) => candidate.includes(term))) {
        matches.push({ sourcePath, visiblePath, index });
        if (matches.length >= MAX_SEARCH_RESULTS) {
          break;
        }
      }
    }

    els.tree.hidden = true;
    els.searchResults.hidden = false;
    els.searchResults.replaceChildren();
    els.statusLine.textContent = `${formatNumber(matches.length)} shown for "${query}"`;

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No matching links.";
      els.searchResults.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const match of matches) {
      const row = document.createElement("div");
      row.className = "result-row";
      const link = document.createElement("a");
      link.className = "result-link";
      link.href = fileUrl(match.sourcePath, match.index);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = match.visiblePath;
      row.appendChild(link);
      fragment.appendChild(row);
    }
    els.searchResults.appendChild(fragment);
  }

  function buildTree(dataset) {
    const root = createFolderNode("");

    for (let pathIndex = 0; pathIndex < dataset.paths.length; pathIndex += 1) {
      const sourcePath = dataset.paths[pathIndex];
      const sourceParts = sourcePath.split("/");
      const visibleParts = sourceParts.map((part, index) => displaySegment(part, index, dataset));
      let node = root;
      node.fileCount += 1;

      for (let index = 0; index < visibleParts.length; index += 1) {
        const part = visibleParts[index];
        const isFile = index === visibleParts.length - 1;
        if (isFile) {
          node.files.push({ name: part, sourcePath, index: pathIndex });
        } else {
          if (!node.children.has(part)) {
            node.children.set(part, createFolderNode(part));
          }
          node = node.children.get(part);
          node.fileCount += 1;
        }
      }
    }

    return root;
  }

  function createFolderNode(name) {
    return {
      name,
      fileCount: 0,
      children: new Map(),
      files: [],
    };
  }

  function renderNodeChildren(node, container, dataset, depth) {
    for (const child of node.children.values()) {
      container.appendChild(createFolderElement(child, dataset, depth));
    }
    for (const file of node.files) {
      container.appendChild(createFileElement(file));
    }
  }

  function createFolderElement(node, dataset, depth) {
    const details = document.createElement("details");
    details.className = "tree-folder";
    details.open = depth < 1;

    const summary = document.createElement("summary");
    const label = document.createElement("span");
    const count = document.createElement("span");
    label.textContent = node.name;
    count.className = "count-pill";
    count.textContent = formatNumber(node.fileCount);
    summary.append(label, count);

    const children = document.createElement("div");
    children.className = "tree-children";

    let rendered = false;
    function ensureRendered() {
      if (!rendered) {
        renderNodeChildren(node, children, dataset, depth + 1);
        rendered = true;
      }
    }

    details.append(summary, children);
    details.addEventListener("toggle", function () {
      if (details.open) {
        ensureRendered();
      }
    });

    if (details.open) {
      ensureRendered();
    }

    return details;
  }

  function createFileElement(file) {
    const row = document.createElement("div");
    row.className = "file-row";

    const link = document.createElement("a");
    link.className = "file-link";
    link.href = fileUrl(file.sourcePath, file.index);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = file.name;

    const type = document.createElement("span");
    type.className = "file-type";
    type.textContent = fileType(file.name);

    row.append(link, type);
    return row;
  }

  function displayPath(sourcePath, dataset) {
    return sourcePath
      .split("/")
      .map((part, index) => displaySegment(part, index, dataset))
      .join("/");
  }

  function displaySegment(part, index, dataset) {
    if (index === 0 && part === dataset.source_root) {
      return dataset.display_root;
    }
    return part;
  }

  async function loadQueryChunks(dataset) {
    const queries = new Array(dataset.paths.length).fill("");
    for (const chunk of dataset.query_chunks || []) {
      const response = await fetch(chunk.file);
      if (!response.ok) {
        throw new Error(`Unable to load ${chunk.file} (${response.status})`);
      }
      const lines = splitCatalogLines(await response.text(), chunk.count);
      for (let offset = 0; offset < chunk.count; offset += 1) {
        queries[chunk.start + offset] = lines[offset] || "";
      }
    }
    return queries;
  }

  function splitCatalogLines(text, expectedCount) {
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === "") {
      lines.pop();
    }
    while (lines.length < expectedCount) {
      lines.push("");
    }
    return lines;
  }

  function fileUrl(sourcePath, index) {
    const dataset = activeDataset();
    const baseUrl = state.manifest.s3_prefix + sourcePath.split("/").map(encodeURIComponent).join("/");
    const query = dataset && dataset.queries ? dataset.queries[index] : "";
    return query ? `${baseUrl}?${query}` : baseUrl;
  }

  function fileType(name) {
    if (name.endsWith(".tif.aux.json")) {
      return "JSON";
    }
    if (name.endsWith(".tif")) {
      return "TIF";
    }
    const index = name.lastIndexOf(".");
    return index >= 0 ? name.slice(index + 1).toUpperCase() : "FILE";
  }

  function activeDataset() {
    return state.datasets.get(state.activeId);
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-US");
  }

  function showError(message) {
    els.statusLine.textContent = "Error";
    const error = document.createElement("div");
    error.className = "error-state";
    error.textContent = message;
    els.tree.replaceChildren(error);
  }
})();
