const { CompositeDisposable } = require('atom');
const Config = require('./config');
const SymbolsView = require('./symbols-view');
const { match } = require('fuzzaldrin');

module.exports = class FileView extends SymbolsView {
  constructor (stack, broker) {
    super(stack, broker);
    this.cachedResults = new Map;
    this.watchedEditors = new WeakSet();

    this.editorsSubscription = atom.workspace.observeTextEditors(editor => {
      if (this.watchedEditors.has(editor)) return;

      const removeFromCache = () => {
        this.cachedResults.delete(editor);
      };

      const editorSubscriptions = new CompositeDisposable();
      let buffer = editor.getBuffer();

      editorSubscriptions.add(
        editor.onDidChangeGrammar(removeFromCache),
        editor.onDidSave(removeFromCache),
        editor.onDidChangePath(removeFromCache),
        buffer.onDidReload(removeFromCache),
        buffer.onDidDestroy(removeFromCache),
        buffer.onDidStopChanging(removeFromCache),
        this.broker.onDidAddProvider(removeFromCache),
        this.broker.onDidRemoveProvider(removeFromCache),
        this.broker.onShouldClearCache(removeFromCache),
        Config.onDidChange(removeFromCache)
      );

      editorSubscriptions.add(
        editor.onDidDestroy(() => {
          this.watchedEditors.delete(editor);
          editorSubscriptions.dispose();
        })
      );

      this.watchedEditors.add(editor);
    });
  }

  destroy () {
    this.editorsSubscription.dispose();
    return super.destroy();
  }

  elementForItem ({ position, name }) {
    const matches = match(name, this.selectListView.getFilterQuery());

    const li = document.createElement('li');
    li.classList.add('two-lines');

    const primaryLine = document.createElement('div');
    primaryLine.classList.add('primary-line');
    primaryLine.appendChild(SymbolsView.highlightMatches(this, name, matches));
    li.appendChild(primaryLine);

    const secondaryLine = document.createElement('div');
    secondaryLine.classList.add('secondary-line');
    secondaryLine.textContent = `Line ${position.row + 1}`;
    li.appendChild(secondaryLine);

    return li;
  }

  didChangeSelection (item) {
    let quickJump = atom.config.get('symbols-view-plus.quickJumpToFileSymbol');
    if (quickJump && item) this.openTag(item);
  }

  async didCancelSelection () {
    this.abortController?.abort();
    await this.cancel();
    let editor = this.getEditor();
    if (editor && this.initialState) {
      this.deserializeEditorState(editor, this.initialState);
    }
    this.initialState = null;
  }

  didConfirmEmptySelection () {
    this.abortController?.abort();
    super.didConfirmEmptySelection();
  }

  async toggle () {
    if (this.panel.isVisible()) await this.cancel();
    let editor = this.getEditor();
    // Remember exactly where the editor is so that we can restore that state
    // if the user cancels.
    let quickJump = atom.config.get('symbols-view-plus.quickJumpToFileSymbol');
    if (quickJump && editor) {
      this.initialState = this.serializeEditorState(editor);
    }
    this.populate(editor);
    this.attach();
  }

  serializeEditorState (editor) {
    let editorElement = atom.views.getView(editor);
    let scrollTop = editorElement.getScrollTop();

    return {
      bufferRanges: editor.getSelectedBufferRanges(),
      scrollTop
    };
  }

  deserializeEditorState (editor, { bufferRanges, scrollTop }) {
    let editorElement = atom.views.getView(editor);

    editor.setSelectedBufferRanges(bufferRanges);
    editorElement.setScrollTop(scrollTop);
  }

  getEditor () {
    return atom.workspace.getActiveTextEditor();
  }

  getPath () {
    return this.getEditor()?.getPath();
  }

  getScopeName () {
    return this.getEditor()?.getGrammar()?.scopeName;
  }

  async populate (editor) {
    let result = this.cachedResults.get(editor);
    if (result) {
      let { symbols, providerName } = result;
      await this.updateListView({
        providerName,
        items: symbols
      });
    } else {
      let result = this.generateSymbols(editor);
      if (result === null) {
        // TODO
        return;
      }
      await this.updateListView({
        items: [],
        loadingMessage: 'Generating symbols\u2026'
      });
      if (result.then) {
        result = await result;
      }
      if (result == null) {
        this.cancel();
        return;
      }
      let { providerName, symbols } = result;
      await this.updateListView({
        providerName,
        items: symbols,
        loadingMessage: null
      });
    }
  }

  generateSymbols (editor) {
    this.abortController?.abort();
    this.abortController = new AbortController();

    let meta = { type: 'file', editor };

    let provider = this.broker.select(meta);
    if (!provider) {
      // TODO: Either show the user a notification or just log a warning to the
      // console, depending on the user's settings and whether we've notified
      // about this already during this session.
      return null;
    }
    let providerName = provider.getName();

    let done = (symbols) => {
      this.cachedResults.set(editor, { providerName, symbols });
      return { providerName, symbols };
    };

    let error = (err) => {
      console.error(`Error in retrieving symbols from provider: ${err.message}`);
      console.warn(provider);
      return null;
    };

    try {
      let symbols = provider.getSymbols({
        signal: this.abortController.signal,
        ...meta
      });
      if (symbols.then) {
        return symbols.then(done).catch(error);
      } else {
        return done(symbols);
      }
    } catch (err) {
      error(err);
      return null;
    }
  }
}
