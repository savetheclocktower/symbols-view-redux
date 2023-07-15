const { CompositeDisposable, Point } = require('atom');
const Config = require('./config');
const SymbolsView = require('./symbols-view');
const { match } = require('fuzzaldrin');

// TODO: Turn this into a config value.
const DEFAULT_TIMEOUT_MS = 2000;

function timeout (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = class FileView extends SymbolsView {
  constructor (stack, broker) {
    super(stack, broker);
    this.cachedResults = new Map();
    // Cached results can be partially invalidated. If a provider wants to
    // clear only its own cached results, keep track of it so that we know to
    // ask it for new symbols in spite of the presence of other results in the
    // cache.
    this.providersWithInvalidatedCaches = new Map();
    this.watchedEditors = new WeakSet();
    this.timeoutMs = DEFAULT_TIMEOUT_MS;

    this.editorsSubscription = atom.workspace.observeTextEditors(editor => {
      if (this.watchedEditors.has(editor)) return;

      const removeFromCache = (provider = null) => {
        if (!provider) {
          this.cachedResults.delete(editor);
          this.providersWithInvalidatedCaches.delete(editor);
          return;
        }
        let results = this.cachedResults.get(editor);
        if (!results || results.length === 0) return;
        results = results.filter(sym => {
          return sym.providerId !== provider.packageName;
        });
        if (results.length === 0) {
          // No other providers had cached any symbols, so we can do the simple
          // thing here.
          this.cachedResults.delete(editor);
          this.providersWithInvalidatedCaches.delete(editor);
          return;
        }
        // There's at least one remaining cached symbol. When we fetch this
        // cache result, we need a way of knowing whether this cache entry is
        // comprehensive. So we'll add this provider to a list of providers
        // that will need re-querying.
        this.cachedResults.set(editor, results);
        let providers = this.providersWithInvalidatedCaches.get(editor);
        if (!providers) {
          providers = new Set();
          this.providersWithInvalidatedCaches.set(editor, providers);
        }
        providers.add(provider);
      };
      const removeAllFromCache = () => removeFromCache(null);

      const editorSubscriptions = new CompositeDisposable();
      let buffer = editor.getBuffer();

      // All the core actions that can invalidate the symbol cache.
      editorSubscriptions.add(
        // Some of them invalidate the entire cache…
        editor.onDidChangeGrammar(removeAllFromCache),
        editor.onDidSave(removeAllFromCache),
        editor.onDidChangePath(removeAllFromCache),
        buffer.onDidReload(removeAllFromCache),
        buffer.onDidDestroy(removeAllFromCache),
        buffer.onDidStopChanging(removeAllFromCache),
        Config.onDidChange(removeAllFromCache),

        // And others only invalidate the cache for one specific provider.
        this.broker.onDidAddProvider(removeFromCache),
        this.broker.onDidRemoveProvider(removeFromCache),
        this.broker.onShouldClearCache((provider = null, someEditor = null) => {
          if (someEditor && editor.id !== someEditor.id) return;
          removeFromCache(provider);
        })
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

  elementForItem ({ position, name, providerName }) {
    // Style matched characters in search results.
    const matches = match(name, this.selectListView.getFilterQuery());

    const li = document.createElement('li');
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
      primaryLine.appendChild(badgeContainer);
    }

    const secondaryLine = document.createElement('div');
    secondaryLine.classList.add('secondary-line');
    secondaryLine.textContent = `Line ${position.row + 1}`;
    li.appendChild(secondaryLine);

    return li;
  }

  didChangeSelection (item) {
    let quickJump = Config.get('quickJumpToFileSymbol');
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
    let quickJump = Config.get('quickJumpToFileSymbol');
    if (quickJump && editor) {
      this.initialState = this.serializeEditorState(editor);
    }

    let populated = this.populate(editor);
    if (!populated) return;
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

  isValidSymbol (symbol) {
    if (!symbol.position || !(symbol.position instanceof Point)) return false;
    if (typeof symbol.name !== 'string') return false;
    return true;
  }

  async populate (editor) {
    let result = this.cachedResults.get(editor);
    let providersToQuery = this.providersWithInvalidatedCaches.get(editor);
    if (result && !providersToQuery?.size) {
      let symbols = result;
      await this.selectListView.update({
        // providerName,
        items: symbols
      });
      return true;
    } else {
      await this.selectListView.update({
        items: [],
        loadingMessage: 'Generating symbols\u2026'
      });
      result = this.generateSymbols(editor, result, providersToQuery);
      if (result?.then) result = await result;
      this.providersWithInvalidatedCaches.delete(editor);

      if (result == null) {
        this.cancel();
        return false;
      }
      result.sort((a, b) => a.position.compare(b.position));
      await this.selectListView.update({
        items: result,
        loadingMessage: null
      });
      return true;
    }
  }

  async generateSymbols (editor, existingSymbols = null, onlyProviders = null) {
    this.abortController?.abort();
    this.abortController = new AbortController();

    let meta = { type: 'file', editor };

    // The signal is how a provider can stop doing work if it's going async,
    // since it'll be able to tell if we've cancelled this command and no
    // longer need the symbols we asked for.
    let signal = this.abortController.signal;

    let providers = this.broker.select(meta);
    // If our last cache result was only partially invalidated, `onlyProviders`
    // will be a `Set` of providers that need re-querying — but only if the
    // broker selected them again in the first place.
    //
    // When re-using a cache result that was preserved in its entirety, we
    // don't give the broker a chance to assemble another list of providers. We
    // should act similarly in the event of partial invalidation, and ignore
    // any providers _except_ the ones whose caches were invalidated.
    if (onlyProviders) {
      providers = providers.filter(p => onlyProviders.has(p));
    }

    if (providers?.length === 0) {
      // TODO: Either show the user a notification or just log a warning to the
      // console, depending on the user's settings and whether we've notified
      // about this already during this session.
      return existingSymbols;
    }

    let done = (symbols, provider) => {
      if (signal.aborted) return;
      if (!Array.isArray(symbols)) {
        error(`Provider did not return a list of symbols`, provider);
        return;
      }
      this.addSymbols(allSymbols, symbols, provider);
    };

    let error = (err, provider) => {
      if (signal.aborted) return;
      let message = typeof err === 'string' ? err : err.message;
      console.error(`Error in retrieving symbols from provider ${provider.name}: ${message}`);
    };

    let tasks = [];
    let allSymbols = existingSymbols ? [...existingSymbols] : [];
    for (let provider of providers) {
      try {
        let symbols = this.getSymbolsFromProvider(provider, signal, meta);
        if (symbols?.then) {
          let task = symbols
            .then((result) => done(result, provider))
            .catch(err => error(err, provider));
          tasks.push(task);
        } else {
          done(symbols, provider);
        }
      } catch (err) {
        error(err, provider);
      }
    }

    if (tasks.length > 0) {
      await Promise.race([Promise.allSettled(tasks), timeout(this.timeoutMs)]);
    }

    if (signal.aborted) {
      // This means the user cancelled the task. No cleanup necessary; the
      // `didCancelSelection` handler would've taken care of that.
      return null;
    }

    this.cachedResults.set(editor, allSymbols);
    return allSymbols;
  }
}
