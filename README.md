# symbols-view-redux

A refactor of `symbols-view`.

This is, in all likelihood, a temporary package; the code here will be contributed back to `symbols-view` unless it’s too disruptive.

## Design

[Design document is here](https://gist.github.com/savetheclocktower/be378d52fd9c6c09fd42af3bfb01b83e).

## Usage

* Install this package.
* Install any number of symbol providers (see below).
* If key shortcuts still invoke the old `symbols-view`, you may want to disable it.

## Providers

### Exclusive providers

More than one of these can (and should) be installed, but every request for symbols will choose one of these providers at most:

* [symbol-provider-tree-sitter](https://web.pulsar-edit.dev/packages/symbol-provider-tree-sitter): Uses Tree-sitter queries to identify symbols.
* [symbol-provider-ctags](https://web.pulsar-edit.dev/packages/symbol-provider-ctags): Uses `ctags` to identify symbols. (The built-in `symbols-view` package uses this approach.)

### Supplementary providers

Any number of these providers can be installed, and each one can optionally contribute symbols to any request for symbols. These tend to be specialized and to contribute symbols that an exclusive provider would not:

* [symbol-provider-bookmarks](https://web.pulsar-edit.dev/packages/symbol-provider-bookmarks): Represents bookmarks as file symbols.
