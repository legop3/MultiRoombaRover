const chatSay = require('./chatSay');
const memoryRead = require('./memoryRead');
const memoryWrite = require('./memoryWrite');
const liftUp = require('./liftUp');
const liftDown = require('./liftDown');
const neatoStart = require('./neatoStart');
const neatoSendHome = require('./neatoSendHome');
const neatoLocate = require('./neatoLocate');
const neatoClearErrors = require('./neatoClearErrors');
const haSetEntity = require('./haSetEntity');

const TOOL_DEFINITIONS = [
  chatSay,
  memoryRead,
  memoryWrite,
  liftUp,
  liftDown,
  neatoStart,
  neatoSendHome,
  neatoLocate,
  neatoClearErrors,
  haSetEntity,
];

function evaluateTools(context = {}) {
  const available = [];
  const blocked = [];
  TOOL_DEFINITIONS.forEach((tool) => {
    const result = typeof tool.availability === 'function' ? tool.availability(context) : { available: false, reason: 'unavailable' };
    if (result?.available) {
      available.push(tool.signature);
      return;
    }
    blocked.push({ tool: tool.signature, reason: result?.reason || 'unavailable' });
  });
  return { available, blocked };
}

module.exports = {
  TOOL_DEFINITIONS,
  evaluateTools,
};
