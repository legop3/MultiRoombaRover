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
const TOOL_BY_ID = new Map(TOOL_DEFINITIONS.map((tool) => [tool.id, tool]));

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

async function executeToolAction(action = {}, context = {}) {
  const toolId = String(action?.tool || '').trim();
  const tool = TOOL_BY_ID.get(toolId);
  if (!tool) {
    throw new Error(`Unknown tool: ${toolId}`);
  }
  if (typeof tool.execute !== 'function') {
    throw new Error(`Tool ${toolId} is not executable`);
  }
  return tool.execute({ ...context, args: action?.args || {} });
}

module.exports = {
  TOOL_DEFINITIONS,
  evaluateTools,
  executeToolAction,
};
