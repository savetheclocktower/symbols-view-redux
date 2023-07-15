const path = require('path');
const fs = require('fs-plus');
const { Point } = require('atom');
const SelectListView = require('atom-select-list');
const { match } = require('fuzzaldrin');

module.exports = class SymbolsView {
  static highlightMatches (context, name, matches, offsetIndex = 0) {
    let lastIndex = 0;
    let matchedChars = [];

    const fragment = document.createDocumentFragment();

    for (let matchIndex of [...matches]) {
      matchIndex -= offsetIndex;
      if (matchIndex < 0) continue;

      let unmatched = name.substring(lastIndex, matchIndex);
      if (unmatched) {
        if (matchedChars.length) {
          let span = document.createElement('span');
          span.classList.add('character-match');
          span.textContent = matchedChars.join('');
          fragment.appendChild(span);
        }
        matchedChars = [];
        fragment.appendChild(document.createTextNode(unmatched));
      }
      matchedChars.push(name[matchIndex]);
      lastIndex = matchIndex + 1;
    }

    if (matchedChars.length) {
      const span = document.createElement('span');
      span.classList.add('character-match');
      span.textContent = matchedChars.join('');
      fragment.appendChild(span);
    }

    // Remaining characters are plain text.
    fragment.appendChild(
      document.createTextNode(name.substring(lastIndex))
    );

    return fragment;
  }

  constructor (stack, broker, options = {}) {
    this.stack = stack;
    this.broker = broker;

    options = {
      emptyMessage: 'No symbols found',
      maxResults: null,
      ...options
    };

    this.selectListView = new SelectListView({
      ...options,
      items: [],
      filterKeyForItem: (item) => item.name,
      elementForItem: this.elementForItem.bind(this),
      didChangeSelection: this.didChangeSelection.bind(this),
      didConfirmSelection: this.didConfirmSelection.bind(this),
      didConfirmEmptySelection: this.didConfirmEmptySelection.bind(this),
      didCancelSelection: this.didCancelSelection.bind(this)
    });

    this.element = this.selectListView.element;
    this.element.classList.add('symbols-view');

    this.panel = atom.workspace.addModalPanel({ item: this, visible: false });

    this.configDisposable = atom.config.observe(
      `symbols-view-redux.showProviderNamesInSymbolsView`,
      (value) => {
        this.shouldShowProviderName = value;
      }
    );
  }

  async setProviderName () {
    await this.selectListView.update()
  }

  async destroy () {
    await this.cancel();
    this.configDisposable.dispose();
    this.panel.destroy();
    return this.selectListView.destroy();
  }

  getFilterKey () {
    return 'name';
  }

  elementForItem ({ position, name, file, directory, providerName }) {
    // Style matched characters in search results.
    const matches = match(name, this.selectListView.getFilterQuery());

    if (atom.project.getPaths().length > 1) {
      file = path.join(path.basename(directory), file);
    }

    let li = document.createElement('li');
    li.classList.add('two-lines');

    let primaryLine = document.createElement('div');
    primaryLine.classList.add('primary-line');
    let nameDiv = document.createElement('div');
    nameDiv.classList.add('name');
    primaryLine.appendChild(nameDiv);
    nameDiv.appendChild(SymbolsView.highlightMatches(this, name, matches));
    li.appendChild(primaryLine);

    if (providerName && this.shouldShowProviderName) {
      let badgeContainer = document.createElement('div');
      badgeContainer.classList.add('badge-container');
      let span = document.createElement('span');
      span.classList.add('badge', 'badge-info', 'badge-small');
      span.textContent = providerName;
      badgeContainer.appendChild(span);
      secondaryLine.appendChild(badgeContainer);
    }

    let secondaryLine = document.createElement('div');
    secondaryLine.classList.add('secondary-line');
    if (position) {
      secondaryLine.textContent = `${file}:${position.row + 1}`;
    } else {
      secondaryLine.textContent = file;
    }
    li.appendChild(secondaryLine);

    return li;
  }

  async cancel () {
    if (!this.isCanceling) {
      this.isCanceling = true;
      await this.selectListView.update({ items: [] });
      this.panel.hide();
      if (this.previouslyFocusedElement) {
        this.previouslyFocusedElement.focus();
        this.previouslyFocusedElement = null;
      }
      this.isCanceling = false;
    }
  }

  didCancelSelection () {
    this.cancel();
  }

  didConfirmEmptySelection () {
    this.cancel();
  }

  async didConfirmSelection (tag) {
    if (tag.file && !fs.isFileSync(path.join(tag.directory, tag.file))) {
      await this.selectListView.update({
        errorMessage: `Selected file does not exist`
      });
      setTimeout(() => {
        this.selectListView.update({ errorMessage: null });
      }, 2000);
    } else {
      await this.cancel();
      this.openTag(tag);
    }
  }

  didChangeSelection (tag) { // eslint-disable-line no-unused-vars
    // no-op
  }

  openTag (tag) {
    let editor = atom.workspace.getActiveTextEditor();
    let previous;
    if (editor) {
      previous = {
        editorId: editor.id,
        position: editor.getCursorBufferPosition(),
        file: editor.getURI()
      };
    }

    let { position } = tag;
    if (!position) position = this.getTagLine(tag);

    let result = false;
    if (tag.file) {
      // Open a different file, then jump to a position.
      atom.workspace.open(path.join(tag.directory, tag.file)).then(() => {
        if (position) {
          return this.moveToPosition(position);
        }
        return undefined;
      });
      result = true;
    } else if (position && previous && !previous.position.isEqual(position)) {
      // Jump to a position in the same file.
      this.moveToPosition(position);
      result = true;
    }
    if (result) this.stack.push(previous);
    return result;
  }

  moveToPosition (position, beginningOfLine = true) {
    let editor = atom.workspace.getActiveTextEditor();
    if (editor) {
      editor.setCursorBufferPosition(position, { autoscroll: false });
      if (beginningOfLine) {
        editor.moveToFirstCharacterOfLine();
      }
      editor.scrollToCursorPosition({ center: true });
    }
  }

  attach () {
    this.previouslyFocusedElement = document.activeElement;
    this.panel.show();
    this.selectListView.reset();
    this.selectListView.focus();
  }

  isValidSymbol () {
    return true;
  }

  addSymbols (allSymbols, newSymbols, provider) {
    for (let symbol of newSymbols) {
      if (!this.isValidSymbol(symbol)) {
        console.warn('Invalid symbol:', symbol);
        continue;
      }
      // We enforce these so that (a) we can show a human-readable name of the
      // provider for each symbol (if the user opts into it), and (b) we can
      // selectively clear cached results for certain providers without
      // affecting others.
      symbol.providerName ??= provider.name;
      symbol.providerId ??= provider.packageName;
      if (symbol.path) {
        let parts = path.parse(symbol.path);
        symbol.directory = `${parts.dir}${path.sep}`;
        symbol.file = parts.base;
      }
      allSymbols.push(symbol);
    }
  }

  // TODO: What on earth is this? Can we possibly still need it?
  getTagLine (tag) {
    if (!tag) return undefined;

    if (tag.lineNumber) {
      return new Point(tag.lineNumber - 1, 0);
    }

    if (!tag.pattern) return undefined;
    let pattern = tag.pattern.replace(/(^\/\^)|(\$\/$)/g, '').trim();
    if (!pattern) return undefined;

    const file = path.join(tag.directory, tag.file);
    if (!fs.isFileSync(file)) return undefined;

    let iterable = fs.readFileSync(file, 'utf8').split('\n');
    for (let index = 0; index < iterable.length; index++) {
      let line = iterable[index];
      if (pattern === line.trim()) {
        return new Point(index, 0);
      }
    }

    return undefined;
  }

  getSymbolsFromProvider (provider, signal, meta) {
    let controller = new AbortController();

    // If the user cancels the task, propagate that cancellation to this
    // provider's AbortController.
    signal.addEventListener('abort', () => controller.abort());

    // Cancel this job automatically if it times out.
    setTimeout(() => controller.abort(), this.timeoutMs);

    return provider.getSymbols({
      signal: controller.signal,
      ...meta
    });
  }
};
