// Barcode-Scanner Configuration
// Purpose: Defines whether the optional physical barcode scanner is active.
// Scope: Contains configuration metadata only and never initializes hardware.
const { strictObject, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'barcodeScanner',
  feature: true,
  defaultValue: { enabled: false },
  schema: strictObject({
    enabled: boolean({ description: 'Registers barcode scanning, barcode administration, and scan-triggered server behavior after restart.' }),
  }, {
    title: 'Barcode scanner',
    description: 'Optional physical barcode scanning and barcode registry service.',
    required: ['enabled'],
  }),
};
