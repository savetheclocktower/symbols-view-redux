
function parseTagName (selector) {
  if (!selector.includes('.')) {
    return [selector, null];
  }
  let tagName = selector.substring(0, selector.indexOf('.'));
  let classes = selector.substring(selector.indexOf('.') + 1);
  let classList = classes.split('.');
  return [tagName ?? 'div', classList];
}

function el (selector, ...args) {
  let attributes = null;
  if (typeof args[0] === 'object' && !args[0].nodeType) {
    attributes = args.shift();
  }

  let [tagName, classList] = parseTagName(selector);

  let element = document.createElement(tagName);
  if (attributes) {
    for (let [attr, value] of Object.entries(attributes)) {
      element.setAttribute(attr, value);
    }
  }
  for (let item of args) {
    if (!item) continue;
    if (typeof item === 'string') {
      item = document.createTextNode(item);
    } else if (Array.isArray(item)) {
      for (let n of item) {
        element.appendChild(n);
      }
    }
    element.appendChild(item);
  }

  if (classList) {
    element.classList.add(...classList);
  }

  return element;
}

module.exports = el;
