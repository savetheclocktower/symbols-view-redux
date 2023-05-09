const { Point } = require('atom');

function wait (ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

module.exports = {
  packageName: 'symbol-provider-very-slow',
  name: 'Very Slow',
  isExclusive: false,
  canProvideSymbols (meta) {
    return true;
  },
  async getSymbols (meta) {
    let { editor, signal } = meta;
    let count = editor.getLineCount();
    let results = [];
    await wait(3000);
    if (signal.aborted) {
      return null;
    }
    return [
      {
        position: new Point(0, 0),
        name: `Slow Symbol on Row 1`
      }
    ];
  }
};
