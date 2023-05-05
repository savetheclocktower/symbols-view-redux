const path = require('path');
const etch = require('etch');
const fs = require('fs-plus');
const temp = require('temp');
const SymbolsView = require('../lib/symbols-view');

const DummyProvider = require('./fixtures/providers/dummy-provider');
const VerySlowProvider = require('./fixtures/providers/very-slow-provider');
const UselessProvider = require('./fixtures/providers/useless-provider.js');
const EmptyProvider = require('./fixtures/providers/empty-provider.js');
const TaggedProvider = require('./fixtures/providers/tagged-provider.js');
const CompetingExclusiveProvider = require('./fixtures/providers/competing-exclusive-provider.js');

const { it, fit, ffit, fffit, beforeEach, afterEach, conditionPromise } = require('./async-spec-helpers');


async function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function choiceCount (symbolsView) {
  return symbolsView.element.querySelectorAll('li').length;
}

function getWorkspaceView () {
  return atom.views.getView(atom.workspace);
}

function getEditorView () {
  return atom.views.getView(atom.workspace.getActiveTextEditor());
}

function getSymbolsView () {
  return atom.workspace.getModalPanels()[0]?.item;
}

async function dispatchAndWaitForChoices (commandName) {
  atom.commands.dispatch(getEditorView(), commandName);
  let symbolsView = atom.workspace.getModalPanels()[0].item;
  await conditionPromise(() => {
    let count = symbolsView.element.querySelectorAll('li').length;
    return count > 0;
  });
}

function registerProvider (...args) {
  let pkg = atom.packages.getActivePackage('symbols-view-plus');
  let main = pkg?.mainModule;
  if (!main) {
    let disposable = atom.packages.onDidActivatePackage(pack => {
      if (pack.name !== 'symbols-view-plus') return;
      for (let provider of args) {
        pack.mainModule.consumeSymbolProvider(provider);
      }
      disposable.dispose();
    });
    atom.packages.getLoadedPackage('symbols-view-plus').activateNow();
  } else {
    for (let provider of args) {
      main.consumeSymbolProvider(provider);
    }
  }
}

describe('SymbolsView', () => {
  let symbolsView, activationPromise, editor, directory, mainModule;

  beforeEach(async () => {
    jasmine.unspy(Date, 'now');
    jasmine.unspy(global, 'setTimeout');

    atom.project.setPaths([
      temp.mkdirSync('other-dir-'),
      temp.mkdirSync('atom-symbols-view-')
    ]);

    directory = atom.project.getDirectories()[1];

    fs.copySync(
      path.join(__dirname, 'fixtures', 'js'),
      atom.project.getPaths()[1]
    );

    atom.config.set('symbols-view-plus.showProviderNamesInSymbolsView', false);

    activationPromise = atom.packages.activatePackage('symbols-view-plus');
    activationPromise.then(() => {
      mainModule = atom.packages.getActivePackage('symbols-view-plus').mainModule;
    });
    jasmine.attachToDOM(getWorkspaceView());
  });

  describe('when toggling file symbols', () => {
    beforeEach(async () => {
      await atom.workspace.open(directory.resolve('sample.js'))
    });

    it('displays all symbols with line numbers', async () => {
      registerProvider(DummyProvider);
      await activationPromise;
      atom.commands.dispatch(getEditorView(), 'symbols-view-plus:toggle-file-symbols');

      symbolsView = atom.workspace.getModalPanels()[0].item;
      await conditionPromise(() => {
        let count = symbolsView.element.querySelectorAll('li').length;
        return count > 0;
      });

      expect(symbolsView.selectListView.refs.loadingMessage).toBeUndefined();
      expect(document.body.contains(symbolsView.element)).toBe(true);
      expect(symbolsView.element.querySelectorAll('li').length).toBe(5);

      expect(symbolsView.element.querySelector('li:first-child .primary-line')).toHaveText('Symbol on Row 1');
      expect(symbolsView.element.querySelector('li:first-child .secondary-line')).toHaveText('Line 1');
      expect(symbolsView.element.querySelector('li:last-child .primary-line')).toHaveText('Symbol on Row 13');
      expect(symbolsView.element.querySelector('li:last-child .secondary-line')).toHaveText('Line 13');
    });

    it('does not wait for providers that take too long', async () => {
      registerProvider(DummyProvider, VerySlowProvider);
      await activationPromise;
      expect(mainModule.broker.providers.length).toBe(2);
      atom.commands.dispatch(getEditorView(), 'symbols-view-plus:toggle-file-symbols');

      symbolsView = atom.workspace.getModalPanels()[0].item;
      await conditionPromise(() => {
        let count = symbolsView.element.querySelectorAll('li').length;
        return count > 0;
      });

      expect(symbolsView.selectListView.refs.loadingMessage).toBeUndefined();
      expect(document.body.contains(symbolsView.element)).toBe(true);
      expect(symbolsView.element.querySelectorAll('li').length).toBe(5);

      expect(symbolsView.element.querySelector('li:first-child .primary-line')).toHaveText('Symbol on Row 1');
      expect(symbolsView.element.querySelector('li:first-child .secondary-line')).toHaveText('Line 1');
      expect(symbolsView.element.querySelector('li:last-child .primary-line')).toHaveText('Symbol on Row 13');
      expect(symbolsView.element.querySelector('li:last-child .secondary-line')).toHaveText('Line 13');
    });

    it('caches tags until the editor changes', async () => {
      registerProvider(DummyProvider);
      await activationPromise;
      editor = atom.workspace.getActiveTextEditor();
      await dispatchAndWaitForChoices('symbols-view-plus:toggle-file-symbols');
      symbolsView = atom.workspace.getModalPanels()[0].item;
      await symbolsView.cancel();

      spyOn(DummyProvider, 'getSymbols').andCallThrough();

      await dispatchAndWaitForChoices('symbols-view-plus:toggle-file-symbols');
      expect(choiceCount(symbolsView)).toBe(5);
      expect(DummyProvider.getSymbols).not.toHaveBeenCalled();
      await symbolsView.cancel();

      await editor.save();
      await dispatchAndWaitForChoices('symbols-view-plus:toggle-file-symbols');

      expect(symbolsView.selectListView.refs.loadingMessage).toBeUndefined();
      expect(choiceCount(symbolsView)).toBe(5);
      expect(DummyProvider.getSymbols).toHaveBeenCalled();
      editor.destroy();
      expect(symbolsView.cachedResults.get(editor)).toBeUndefined();
    });

    it('displays a message when no tags match text in mini-editor', async () => {
      registerProvider(DummyProvider);
      await activationPromise;
      await dispatchAndWaitForChoices('symbols-view-plus:toggle-file-symbols');

      symbolsView = getSymbolsView();
      symbolsView.selectListView.refs.queryEditor.setText('nothing will match this');

      await conditionPromise(() => symbolsView.selectListView.refs.emptyMessage);
      expect(document.body.contains(symbolsView.element)).toBe(true);
      expect(choiceCount(symbolsView)).toBe(0);

      expect(symbolsView.selectListView.refs.emptyMessage.textContent.length).toBeGreaterThan(0);

      symbolsView.selectListView.refs.queryEditor.setText('');
      await conditionPromise(() => choiceCount(symbolsView) > 0);
      expect( choiceCount(symbolsView) ).toBe(5);
      expect(symbolsView.selectListView.refs.emptyMessage).toBeUndefined();
    });

    it('moves the cursor to the selected function', async () => {
      registerProvider(DummyProvider);
      await activationPromise;
      editor = atom.workspace.getActiveTextEditor();
      expect(editor.getCursorBufferPosition()).toEqual([0, 0]);
      await dispatchAndWaitForChoices('symbols-view-plus:toggle-file-symbols');
      symbolsView = getSymbolsView();

      symbolsView.element.querySelectorAll('li')[1].click();
      // It'll move to the first non-whitespace character on the line.
      expect(editor.getCursorBufferPosition()).toEqual([3, 4]);
    });

    describe('when there are multiple exclusive providers', () => {
      describe("and none have priority in the user's settings", () => {
        it('prefers the one with the highest score', async () => {
          registerProvider(DummyProvider, CompetingExclusiveProvider);
          spyOn(CompetingExclusiveProvider, 'getSymbols').andCallThrough();
          spyOn(DummyProvider, 'getSymbols').andCallThrough();
          await activationPromise;
          await dispatchAndWaitForChoices('symbols-view-plus:toggle-file-symbols');
          symbolsView = getSymbolsView();
          expect(choiceCount(symbolsView)).toBe(5);
          expect(DummyProvider.getSymbols).toHaveBeenCalled();
          expect(CompetingExclusiveProvider.getSymbols).not.toHaveBeenCalled();
        });
      });

      describe('and one is listed in `preferCertainProviders`', () => {
        beforeEach(() => {
          atom.config.set('symbols-view-plus.preferCertainProviders', ['symbol-provider-competing-exclusive']);
        });

        it('prefers the one with the highest score (providers listed beating those not listed)', async () => {
          registerProvider(DummyProvider, CompetingExclusiveProvider);
          spyOn(CompetingExclusiveProvider, 'getSymbols').andCallThrough();
          spyOn(DummyProvider, 'getSymbols').andCallThrough();
          await activationPromise;
          await dispatchAndWaitForChoices('symbols-view-plus:toggle-file-symbols');
          symbolsView = getSymbolsView();
          expect(choiceCount(symbolsView)).toBe(5);
          expect(DummyProvider.getSymbols).not.toHaveBeenCalled();
          expect(CompetingExclusiveProvider.getSymbols).toHaveBeenCalled();
        });
      });

      describe('and more than one is listed in `preferCertainProviders`', () => {
        beforeEach(() => {
          atom.config.set('symbols-view-plus.preferCertainProviders', ['symbol-provider-competing-exclusive', 'symbol-provider-dummy']);
        });

        it('prefers the one with the highest score (providers listed earlier beating those listed later)', async () => {
          registerProvider(DummyProvider, CompetingExclusiveProvider);
          spyOn(CompetingExclusiveProvider, 'getSymbols').andCallThrough();
          spyOn(DummyProvider, 'getSymbols').andCallThrough();
          await activationPromise;
          await dispatchAndWaitForChoices('symbols-view-plus:toggle-file-symbols');
          symbolsView = getSymbolsView();
          expect(choiceCount(symbolsView)).toBe(5);
          expect(DummyProvider.getSymbols).not.toHaveBeenCalled();
          expect(CompetingExclusiveProvider.getSymbols).toHaveBeenCalled();
        });
      });
    });

    describe('when no symbols are found', () => {
      it('shows the list view with an error message', async () => {
        registerProvider(EmptyProvider);
        await activationPromise;
        atom.commands.dispatch(getEditorView(), 'symbols-view-plus:toggle-file-symbols');
        await conditionPromise(() => getSymbolsView()?.selectListView.refs.emptyMessage);
        symbolsView = getSymbolsView();

        expect(document.body.contains(symbolsView.element));
        expect(choiceCount(symbolsView)).toBe(0);
        let refs = symbolsView.selectListView.refs;
        expect(refs.emptyMessage).toBeVisible();
        expect(refs.emptyMessage.textContent.length).toBeGreaterThan(0);
        expect(refs.loadingMessage).not.toBeVisible();
      })
    });

    describe("when symbols can't be generated for a file", () => {
      it('does not show the list view', async () => {
        registerProvider(UselessProvider);
        await activationPromise;
        expect(mainModule.broker.providers.length).toBe(1);
        atom.commands.dispatch(getEditorView(), 'symbols-view-plus:toggle-file-symbols');

        await wait(1000);
        symbolsView = atom.workspace.getModalPanels()[0].item;

        // List view should not be visible, nor should it have any options.
        expect(
          symbolsView.element.querySelectorAll('li').length
        ).toBe(0);
        expect(symbolsView.element).not.toBeVisible();
      });
    })
  });

  describe('when toggling project symbols', () => {
    beforeEach(async () => {
      await atom.workspace.open(directory.resolve('sample.js'))
    });

    it('displays all symbols', async () => {
      registerProvider(DummyProvider);
      await activationPromise;
      await dispatchAndWaitForChoices('symbols-view-plus:toggle-project-symbols');
      symbolsView = atom.workspace.getModalPanels()[0].item;

      expect(symbolsView.selectListView.refs.loadingMessage).toBeUndefined();
      expect(document.body.contains(symbolsView.element)).toBe(true);
      expect(symbolsView.element.querySelectorAll('li').length).toBe(5);

      let root = atom.project.getPaths()[1];
      let resolved = directory.resolve('other-file.js');
      let relative = `${path.basename(root)}${resolved.replace(root, '')}`;

      expect(symbolsView.element.querySelector('li:first-child .primary-line')).toHaveText('Symbol on Row 1');
      expect(symbolsView.element.querySelector('li:first-child .secondary-line')).toHaveText(`${relative}:1`);
      expect(symbolsView.element.querySelector('li:last-child .primary-line')).toHaveText('Symbol on Row 13');
      expect(symbolsView.element.querySelector('li:last-child .secondary-line')).toHaveText(`${relative}:13`);
    });

    describe('when there is only one project', () => {
      beforeEach(() => {
        atom.project.setPaths([directory.getPath()]);
      });

      it("does not include the root directory's name when displaying the symbol's filename", async () => {
        registerProvider(TaggedProvider);
        await atom.workspace.open(directory.resolve('tagged.js'));
        await activationPromise;
        expect(getWorkspaceView().querySelector('.symbols-view')).toBeNull();
        await dispatchAndWaitForChoices('symbols-view-plus:toggle-project-symbols');
        symbolsView = getSymbolsView();

        expect(choiceCount(symbolsView)).toBe(1);

        expect(symbolsView.element.querySelector('li:first-child .primary-line')).toHaveText('callMeMaybe');
        expect(symbolsView.element.querySelector('li:first-child .secondary-line')).toHaveText('tagged.js:3');
      });
    });

    describe('when selecting a tag', () => {
      describe("when the file doesn't exist", () => {
        beforeEach(async () => fs.removeSync(directory.resolve('tagged.js')));

        it("doesn't open the editor", async () => {
          registerProvider(TaggedProvider);
          await activationPromise;
          await dispatchAndWaitForChoices('symbols-view-plus:toggle-project-symbols');
          symbolsView = getSymbolsView();

          spyOn(atom.workspace, 'open').andCallThrough();

          symbolsView.element.querySelector('li:first-child').click();

          await conditionPromise(() => symbolsView.selectListView.refs.errorMessage);

          expect(atom.workspace.open).not.toHaveBeenCalled();
          expect(
            symbolsView.selectListView.refs.errorMessage.textContent.length
          ).toBeGreaterThan(0);
        });
      });
    });

    describe('when quickJumpToSymbol is true', () => {
      beforeEach(async () => {
        await atom.workspace.open(directory.resolve('sample.js'));
      });

      it('jumps to the selected function', async () => {
        registerProvider(DummyProvider);
        await activationPromise;
        editor = atom.workspace.getActiveTextEditor();
        expect(editor.getCursorBufferPosition()).toEqual([0, 0]);
        await dispatchAndWaitForChoices('symbols-view-plus:toggle-file-symbols');
        symbolsView = getSymbolsView();

        symbolsView.selectListView.selectNext();

        expect(editor.getCursorBufferPosition()).toEqual([3, 4]);
      });

      // NOTE: If this test fails, could it have been because you opened the
      // dev tools console? That seems to break it on a reliable basis. Not
      // sure why yet.
      it('restores previous editor state on cancel', async () => {
        registerProvider(DummyProvider);
        await activationPromise;
        const bufferRanges = [{start: {row: 0, column: 0}, end: {row: 0, column: 3}}];
        editor = atom.workspace.getActiveTextEditor();
        editor.setSelectedBufferRanges(bufferRanges);

        await dispatchAndWaitForChoices('symbols-view-plus:toggle-file-symbols');
        symbolsView = getSymbolsView();

        symbolsView.selectListView.selectNext();
        expect(editor.getCursorBufferPosition()).toEqual([3, 4]);

        await symbolsView.cancel();
        expect(editor.getSelectedBufferRanges()).toEqual(bufferRanges);
      });
    });

    describe('when quickJumpToSymbol is false', () => {
      beforeEach(async () => {
        atom.config.set('symbols-view-plus.quickJumpToFileSymbol', false);
        await atom.workspace.open(directory.resolve('sample.js'));
      });

      it("won't jump to the selected function", async () => {
        registerProvider(DummyProvider);
        await activationPromise;
        editor = atom.workspace.getActiveTextEditor();
        expect(editor.getCursorBufferPosition()).toEqual([0, 0]);

        await dispatchAndWaitForChoices('symbols-view-plus:toggle-file-symbols');
        symbolsView = getSymbolsView();
        symbolsView.selectListView.selectNext();
        expect(editor.getCursorBufferPosition()).toEqual([0, 0]);
      });
    });
  });

});
