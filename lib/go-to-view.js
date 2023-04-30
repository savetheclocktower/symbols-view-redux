
// const path = require('path');
const SymbolsView = require('./symbols-view');

module.exports = class GoToView extends SymbolsView {
  constructor (stack, broker) {
    super(stack, broker);
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

    let meta = {
      type: 'project-find',
      editor: atom.workspace.getActiveTextEditor(),
      paths: atom.project.getPaths()
    };

    let provider = this.broker.select(meta);
    if (!provider) {
      // TODO
      return;
    }

    this.abortController?.abort();
    this.abortController = new AbortController();

    let symbols = await provider.getSymbols({
      signal: this.abortController.signal,
      ...meta
    });

    if (!symbols?.length) {
      // TODO
      return;
    }

    if (symbols.length === 1) {
      if (this.openTag(symbols[0])) return;
    }

    // There must be multiple tags.
    await this.selectListView.update({ items: symbols });
    this.attach();
  }
}
