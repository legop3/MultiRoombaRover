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
const buttonBoxAddCount = require('./buttonBoxAddCount');

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
  buttonBoxAddCount,
];
const TOOL_BY_ID = new Map(TOOL_DEFINITIONS.map((tool) => [tool.id, tool]));

function evaluateTools(context = {}) {
  const available = [];
  const availableIds = [];
  const blocked = [];
  TOOL_DEFINITIONS.forEach((tool) => {
    const result = typeof tool.availability === 'function' ? tool.availability(context) : { available: false, reason: 'unavailable' };
    if (result?.available) {
      available.push(tool.signature);
      availableIds.push(tool.id);
      return;
    }
    blocked.push({ id: tool.id, tool: tool.signature, reason: result?.reason || 'unavailable' });
  });
  return { available, availableIds, blocked };
}

function buildOllamaTools(availableIds = []) {
  const allowed = new Set((availableIds || []).map((id) => String(id)));
  return TOOL_DEFINITIONS.filter((tool) => allowed.has(tool.id)).map((tool) => ({
    type: 'function',
    function: {
      name: tool.id,
      description: String(tool.description || tool.signature || tool.id),
      parameters: tool.parameters || {
        type: 'object',
        properties: {},
      },
    },
  }));
}

async function executeToolAction(toolId, args = {}, context = {}) {
  const key = String(toolId || '').trim();
  if (!key) throw new Error('Missing tool id');
  const tool = TOOL_BY_ID.get(key);
  if (!tool) {
    throw new Error(`Unknown tool: ${key}`);
  }
  if (typeof tool.execute !== 'function') {
    throw new Error(`Tool ${key} is not executable`);
  }
  return tool.execute({ ...context, args: args || {} });
}

function getToolById(toolId) {
  return TOOL_BY_ID.get(String(toolId || '').trim()) || null;
}

function getIdForSignature(signature) {
  const sig = String(signature || '').trim();
  const match = TOOL_DEFINITIONS.find((tool) => tool.signature === sig);
  return match?.id || null;
}

module.exports = {
  TOOL_DEFINITIONS,
  evaluateTools,
  buildOllamaTools,
  executeToolAction,
  getToolById,
  getIdForSignature,
};
