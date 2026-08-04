#!/usr/bin/env node
// MediaMTX Configuration Validator
// Purpose: Lets the installer validate server-owned MediaMTX inputs before disabling the legacy service.
// Scope: Builds and serializes the runtime YAML without starting MediaMTX or changing external state.
const yaml = require('js-yaml');
const { loadConfig } = require('../src/helpers/configLoader');
const { buildMediaMtxConfig } = require('../src/services/mediaMtxService/config');

const config = loadConfig();
const generated = buildMediaMtxConfig({
  config,
  serverPort: process.env.PORT || 8080,
  snapshotWriterPath: process.env.ROVER_SNAPSHOT_WRITER_BIN || '/usr/local/bin/rover-snapshot-writer.sh',
});

/*
  Serializing is part of validation: it catches values that the builder accepted but js-yaml
  cannot represent before the installer removes the previous service configuration.
*/
yaml.dump(generated, { noRefs: true, lineWidth: 120 });
process.stdout.write('MediaMTX server configuration is valid\n');
