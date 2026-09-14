// Barcode Games Configuration
// Purpose: Defines the optional barcode-games identity and presentation.
// Scope: Contains configuration metadata only and does not initialize game state.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'barcodeGames',
  feature: true,
  defaultValue: { enabled: false, botName: 'Barcode Games', profileImageUrl: '' },
  schema: strictObject({
    enabled: boolean(),
    botName: string({ minLength: 1, maxLength: 80 }),
    profileImageUrl: string({ title: 'Profile image URL', maxLength: 2048 }),
  }, { title: 'Barcode games', required: ['enabled', 'botName', 'profileImageUrl'] }),
};
