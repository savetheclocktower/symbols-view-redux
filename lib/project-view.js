const { Point } = require('atom');
const SymbolsView = require('./symbols-view');

// TODO: Turn this into a config value.
const DEFAULT_TIMEOUT_MS = 2000;

function timeout (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = class ProjectView extends SymbolsView {
  constructor (stack, broker) {
    // TODO: Do these defaults make sense? Should we allow a provider to
    // override them?
    super(stack, broker, {
      emptyMessage: 'Project has no symbols or is empty',
      maxResults: 10
    });

    this.timeoutMs = DEFAULT_TIMEOUT_MS;
    this.reloadTags = true;
  }

  destroy () {
    return super.destroy();
  }

  toggle () {
    if (this.panel.isVisible()) {
      this.cancel();
    } else {
      this.populate();
      this.attach();
    }
  }

  didCancelSelection () {
    this.abortController?.abort();
    super.didCancelSelection();
  }

  didConfirmEmptySelection () {
    this.abortController?.abort();
    super.didConfirmEmptySelection();
  }

  isValidSymbol (symbol) {
    if (!symbol.position || !(symbol.position instanceof Point)) {
      return false;
    }
    for (let prop of ['name', 'directory', 'file']) {
      if (typeof symbol[prop] !== 'string') {
        return false;
      }
    }
    return true;
  }

  async populate () {
    if (this.cachedSymbols && !this.shouldReload) {
      await this.selectListView.update({ items: this.cachedSymbols });
      return true;
    }

    let listViewOptions = {
      loadingMessage: this.cachedSymbols ?
        `Reloading project symbols\u2026` :
        `Loading project symbols\u2026`
    };


    if (!this.cachedSymbols) {
      listViewOptions.loadingBadge = 0;
    }

    await this.selectListView.update(listViewOptions);
    let editor = atom.workspace.getActiveTextEditor();

    let result = this.generateSymbols(editor, (symbols) => {
      this.selectListView.update({
        loadingBadge: symbols.length
      });
    });

    if (result?.then) result = await result;
    if (result == null) {
      this.cancel();
      return false;
    }
    result.sort((a, b) => a.position.compare(b.position));

    await this.selectListView.update({
      items: result,
      loadingMessage: null
    });

    this.cachedSymbols = result;
    this.shouldReload = result.length > 0;
    return true;
  }

  async generateSymbols (editor, callback) {
    this.abortController?.abort();
    this.abortController = new AbortController();

    let meta = { type: 'project', editor };

    // The signal is how a provider can stop doing work if it's going async,
    // since it'll be able to tell if we've cancelled this command and no
    // longer need the symbols we asked for.
    let signal = this.abortController.signal;

    let providers = this.broker.select(meta);
    if (providers?.length === 0) {
      return null;
    }

    let allSymbols = [];
    let done = (symbols, provider) => {
      if (!Array.isArray(symbols)) {
        error(`Provider did not return a list of symbols`, provider);
        return;
      }
      this.addSymbols(allSymbols, symbols, provider);
      callback(allSymbols);
    };

    let error = (err, provider) => {
      let message = typeof err === 'string' ? err : err.message;
      console.error(`Error in retrieving symbols from provider ${provider.name}: ${message}`);
    };

    let tasks = [];
    for (let provider of providers) {
      try {
        let symbols = this.getSymbolsFromProvider(provider, signal, meta);
        if (symbols?.then) {
          let task = symbols
            .then((result) => done(result, provider))
            .catch(err => error(err, provider));
          tasks.push(task);
        } else if (Array.isArray(symbols)) {
          done(symbols, provider);
        } else {
          error(`Provider did not return a list of symbols`, provider);
        }
      } catch (err) {
        error(err, provider);
      }
    }

    if (tasks.length > 0) {
      await Promise.race([Promise.allSettled(tasks), timeout(this.timeoutMs)]);
    }

    // Since we might've gone async here, we should check our own signal. If
    // it's aborted, that means the user has cancelled.
    if (signal.aborted) return null;

    this.cachedSymbols = allSymbols;
    return allSymbols;
  }
};
