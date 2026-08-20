// Help Content Definitions
// Purpose: Stores static/dynamic help text content displayed by help UI components. Scope: Central content source for onboarding instructions and control references.
export const HELP_LAYOUTS = ['desktop', 'mobile-portrait', 'mobile-landscape'];

// Block-based help content; each layout defines a hero plus main/aside blocks.
// Text supports inline key pills via segments: strings or { action: 'driveMacro' }.
export const HELP_CONTENT = {
  desktop: {
    main: [
      {
        type: 'list',
        title: 'Chat and nicknames',
        items: [
          'Chat and nickname controls are in the Chat/Rovers tab.',
          { segments: ['Open the HUD chat composer with ', { action: 'chatFocus' }, '. Press ', { action: 'chatFocus'}, ' again to send.'] },
        ]
      },
      {
        type: 'list',
        title: 'Driving the rover',
        items: [
          { segments: ['Click "Your rover is docked", or press ', { action: 'driveMacro' }, ', to undock.'] },
          'Drive with the movement keybindings.',
          'Rover controls dim while another person has the turn.',
        ],
      },
      {
        type: 'list',
        title: 'Video HUD',
        items: [
          'Top left shows the rover name and turns.',
          'Top right shows battery and rover status.',
          'Bottom left contains horn, headlight, and laser controls.',
          'Bottom right contains camera tilt and chat.',
          'Use the arrows to open and close pods and their expansions.',
        ],
      },
      {
        type: 'list',
        title: 'Page layout',
        items: [
          'Room, Activities, and VIP are in the left sidebar.',
          'Chat/Rovers, Help, and Settings are in the right sidebar.',
        ],
      },
      {
        type: 'list',
        title: 'Docking the rover',
        items: [
          { segments: ['Click "Dock rover", or press ', { action: 'dockMacro' }, '.'] },
          'Click "Rover is docking itself" to resume driving.',
        ],
      },
    ],
    aside: [
      {
        type: 'keyboard',
        title: 'Keyboard controls',
        footnote: 'Per-browser; adjust bindings and speeds in Settings → Keybindings.',
        groups: [
          {
            id: 'movement',
            title: 'Movement',
            items: [
              { action: 'driveForward', label: 'Forward' },
              { action: 'driveBackward', label: 'Backward' },
              { action: 'driveLeft', label: 'Turn left' },
              { action: 'driveRight', label: 'Turn right' },
              { action: 'boostModifier', label: 'Boost speed' },
              { action: 'slowModifier', label: 'Precision speed' },
            ],
          },
          {
            id: 'macros',
            title: 'Rover modes & chat',
            items: [
              { action: 'driveMacro', label: 'Undock / resume driving' },
              { action: 'dockMacro', label: 'Dock rover' },
              { action: 'chatFocus', label: 'Chat focus' },
            ],
          },
          {
            id: 'camera',
            title: 'Camera',
            items: [
              { action: 'cameraUp', label: 'Tilt up' },
              { action: 'cameraDown', label: 'Tilt down' },
              { action: 'headlightToggle', label: 'Toggle headlight' },
              { action: 'laserToggle', label: 'Toggle laser' },
            ],
          },
          {
            id: 'motors',
            title: 'Rover Aux Motors',
            items: [
              { action: 'auxMainForward', label: 'Main brush forward' },
              { action: 'auxMainReverse', label: 'Main brush reverse' },
              { action: 'auxSideForward', label: 'Side brush forward' },
              { action: 'auxSideReverse', label: 'Side brush reverse' },
              { action: 'auxVacuumFast', label: 'Vacuum max' },
              { action: 'auxVacuumSlow', label: 'Vacuum low' },
              { action: 'auxAllForward', label: 'All motors forward' },
            ],
          },
          {
            id: 'audio',
            title: 'Audio / Song',
            items: [
              { action: 'songNoteUp', label: 'Song note up' },
              { action: 'songNoteDown', label: 'Song note down' },
            ],
          },
          {
            id: 'room-controls',
            title: 'Room Controls',
            items: [
              { action: 'homeAssistantOn', label: 'Next room control on' },
              { action: 'homeAssistantOff', label: 'Next room control off (reverse)' },
            ],
          },
        ],
      },
      {
        type: 'gamepad',
        title: 'Gamepad / joystick',
        items: [
          'Gamepad controls are fully configurable to handle inconsistent browser mappings.',
          'Use Settings → Controller to bind inputs, calibrate deadzones, and view diagnostics.',
          'If inputs behave oddly, the diagnostics panel will show raw axis/button values.'
        ],
      },
    ],
  },
  'mobile-portrait': {
    main: [
      {
        type: 'list',
        title: 'Chat and nicknames',
        items: [
          'Chat and nickname controls are in the Chat tab.',
          'Tap the chat box to send a message.',
        ]
      },
      {
        type: 'list',
        title: 'Driving the rover',
        items: [
          'Tap "Your rover is docked" to undock.',
          'Hold and drag on the drive pad.',
          'Choose Precision, Normal, or Turbo above the drive pad.',
          'Use the other column for rover controls.',
          'Rover controls dim while another person has the turn.',
        ],
      },
      {
        type: 'list',
        title: 'Docking the rover',
        items: [
          'Tap "Dock and charge" when finished.',
        ],
      },
      {
        type: 'list',
        title: 'More controls',
        items: [
          'Chat, Activities, VIP, Room Controls, Help, and Settings are below the rover controls.',
        ],
      },
    ],
  },
  'mobile-landscape': {
    main: [
      {
        type: 'list',
        title: 'Chat and nicknames',
        items: [
          'Chat and nickname controls are in the Chat tab.',
          'Tap the chat box to send a message.',
        ]
      },
      {
        type: 'list',
        title: 'Driving the rover',
        items: [
          'Tap "Your rover is docked" to undock.',
          'Hold and drag on the drive pad.',
          'Choose Precision, Normal, or Turbo above the drive pad.',
          'Use the other column for rover controls.',
          'Rover controls dim while another person has the turn.',
        ],
      },
      {
        type: 'list',
        title: 'Docking the rover',
        items: [
          'Tap "Dock and charge" when finished.',
        ],
      },
      {
        type: 'list',
        title: 'More controls',
        items: [
          'Chat, Activities, VIP, Room Controls, Help, and Settings are below the rover controls.',
        ],
      },
    ],
    // aside: [
    //   {
    //     type: 'keyboard',
    //     title: 'Keyboard (if attached)',
    //     footnote: 'Per-browser; adjust in Settings → Controls.',
    //     groups: [
    //       {
    //         id: 'movement',
    //         title: 'Movement',
    //         items: [
    //           { action: 'driveForward', label: 'Forward' },
    //           { action: 'driveBackward', label: 'Backward' },
    //           { action: 'driveLeft', label: 'Turn left' },
    //           { action: 'driveRight', label: 'Turn right' },
    //           { action: 'boostModifier', label: 'Boost' },
    //           { action: 'slowModifier', label: 'Precision' },
    //         ],
    //       },
    //       {
    //         id: 'camera',
    //         title: 'Camera',
    //         items: [
    //           { action: 'cameraUp', label: 'Tilt up' },
    //           { action: 'cameraDown', label: 'Tilt down' },
    //         ],
    //       },
    //       {
    //         id: 'macros',
    //         title: 'Macros & chat',
    //         items: [
    //           { action: 'driveMacro', label: 'Drive macro' },
    //           { action: 'dockMacro', label: 'Dock macro' },
    //           { action: 'headlightToggle', label: 'Toggle headlight' },
    //           { action: 'laserToggle', label: 'Toggle laser' },
    //           { action: 'chatFocus', label: 'Chat focus' },
    //         ],
    //       },
    //     ],
    //   },
    //   {
    //     type: 'gamepad',
    //     title: 'Gamepad / joystick',
    //     items: [
    //       'Left stick drives; right stick/D-pad: camera when mapped.',
    //       'Buttons can trigger macros or aux motors; adjust deadzones if drifting.',
    //     ],
    //   },
    // ],
  },
};

export function getHelpContent(layout) {
  return HELP_CONTENT[layout] || HELP_CONTENT.desktop;
}
