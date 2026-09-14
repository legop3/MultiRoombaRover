// Barcode-Scanner Configuration
// Purpose: Defines whether the optional physical barcode scanner is active.
// Scope: Contains configuration metadata only and never initializes hardware.
const { strictObject, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'barcodeScanner',
  feature: true,
  defaultValue: { enabled: false },
  schema: strictObject({ enabled: boolean() }, { title: 'Barcode scanner', required: ['enabled'] }),
};
