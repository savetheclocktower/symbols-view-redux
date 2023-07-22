const SymbolsView = require('./symbols-view');

// TODO: Turn this into a config value.
const DEFAULT_TIMEOUT_MS = 2000;

function timeout (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = class GoToView extends SymbolsView {
  constructor (stack, broker) {
    super(stack, broker);
    this.timeoutMs = DEFAULT_TIMEOUT_MS;
  }

  toggle () {
    if (this.panel.isVisible()) {
      this.cancel();
    } else {
      this.populate();
    }
  }

  detached () {
    // TODO
    this.abortController?.abort();
  }

  async populate () {
    let editor = atom.workspace.getActiveTextEditor();
    if (!editor) return;

    let symbols = await this.generateSymbols(editor);

    if (symbols?.length === 0) {
      // TODO
      console.warn('No symbols!');
      return;
    }

    if (symbols.length === 1) {
      if (this.openTag(symbols[0])) return;
    }

    // There must be multiple tags.
    await this.selectListView.update({ items: symbols });
    this.attach();
  }

  async generateSymbols (editor) {
    this.abortController?.abort();
    this.abortController = new AbortController();

    let meta = {
      type: 'project-find',
      editor,
      paths: atom.project.getPaths()
    };

    let signal = this.abortController.signal;

    let providers = await this.broker.select(meta);
    if (providers?.length === 0) {
      // TODO
      return [];
    }

    let allSymbols = [];

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
    for (let provider of providers) {
      try {
        let symbols = this.getSymbolsFromProvider(provider, signal, meta);
        if (symbols?.then) {
          let task = symbols
            .then(result => done(result, provider))
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
      return null;
    }

    return allSymbols;
  }
}
