// Barcode-Scanner Configuration
// Purpose: Defines whether the optional physical barcode scanner is active.
// Scope: Contains configuration metadata only and never initializes hardware.
const { strictObject, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'barcodeScanner',
  feature: true,
  defaultValue: { enabled: false },
  schema: strictObject({
    enabled: boolean({ description: 'Immediately enables barcode scanning, barcode administration, and scan-triggered server behavior.' }),
  }, {
    title: 'Barcode scanner',
    description: 'Optional physical barcode scanning and barcode registry service.',
    required: ['enabled'],
  }),
};
