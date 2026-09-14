// Barcode Games Configuration
// Purpose: Defines the optional barcode-games identity and presentation.
// Scope: Contains configuration metadata only and does not initialize game state.
const { strictObject, string, boolean } = require('../../configuration/schemaHelpers');

module.exports = {
  key: 'barcodeGames',
  feature: true,
  defaultValue: { enabled: false, botName: 'Barcode Games', profileImageUrl: '' },
  schema: strictObject({
    enabled: boolean({ description: 'Enables shared barcode-game voting, participation, scoring, and game-state publication.' }),
    botName: string({ description: 'Nickname used for barcode-game lifecycle messages posted into chat.', minLength: 1, maxLength: 80 }),
    profileImageUrl: string({ title: 'Profile image URL', description: 'Optional image URL displayed beside barcode-game chat messages; leave blank for no custom image.', maxLength: 2048 }),
  }, { title: 'Barcode games', description: 'Controls the multiplayer games driven by scans received from the barcode scanner service.', required: ['enabled', 'botName', 'profileImageUrl'] }),
};
