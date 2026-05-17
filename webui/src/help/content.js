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
          'Set a nickname in the user list panel, on the bottom left of the page below the rover video.',
          { segments: ['Toggle chat focus with ', { action: 'chatFocus' }, '. Press ', { action: 'chatFocus'}, ' again to send.'] },
        ]
      },
      {
        type: 'list',
        title: 'Driving the rover',
        items: [
          { segments: ['Press the "Start Driving" button onscreen, or press ' , { action: 'driveMacro' }, ' on your keyboard to put the rover into driving mode.'] },
          'Refer to the controls for the controls for the rover.'
        ],
      },
      {
        type: 'list',
        title: 'Docking the rover',
        items: [
          'If the rover shows "Docking in Progress", it is already auto-seeking the dock.',
          'To dock manually, enter Docking Assist from the drive panel.',
          { segments: ['Press "Enter Docking Assist", or press ', { action: 'dockMacro' }, '.'] },
          'In assist mode, camera tilts down and driving speed is limited for precise alignment.',
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
              { action: 'driveMacro', label: 'Drive macro' },
              { action: 'dockMacro', label: 'Docking assist toggle' },
              { action: 'chatFocus', label: 'Chat focus' },
            ],
          },
          {
            id: 'camera',
            title: 'Camera',
            items: [
              { action: 'cameraUp', label: 'Tilt up' },
              { action: 'cameraDown', label: 'Tilt down' },
              { action: 'nightVisionToggle', label: 'Toggle night vision' },
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
          'Set a nickname in the user list panel below.',
          'Tap in the chat box to send messages in the chat.'
        ]
      },
      {
        type: 'list',
        title: 'Driving the rover',
        items: [
          { segments: ['Press the "Start Driving" button onscreen to put the rover into driving mode.'] },
          'Look below the rover video. Use the joystick column to move the rover, and hold the aux buttons in the other control column.'
        ],
      },
      {
        type: 'list',
        title: 'Docking the rover',
        items: [
          'If you see "Docking in Progress", the rover is currently auto-seeking the dock.',
          { segments: ['For manual docking, press "Enter Docking Assist".'] },
          'Assist mode tilts camera down and limits speed for precise alignment.',
        ],
      }
    ],
  },
  'mobile-landscape': {
    main: [
      {
        type: 'list',
        title: 'Chat and nicknames',
        items: [
          'Scroll down to see more of the page.',
          'Set a nickname in the user list panel below.',
          'Tap in the chat box to send messages in the chat.'
        ]
      },
      {
        type: 'list',
        title: 'Driving the rover',
        items: [
          { segments: ['Press the "Start Driving" button, or the "Drive" button to put the rover into driving mode.'] },
          'Use the joystick column beside the video feed to move the rover, and hold the aux buttons in the other control column.'
        ],
      },
      {
        type: 'list',
        title: 'Docking the rover',
        items: [
          'If you see "Docking in Progress", the rover is currently auto-seeking the dock.',
          { segments: ['For manual docking, press "Enter Docking Assist" (or "Dock" button).'] },
          'Assist mode tilts camera down and limits speed for precise alignment.',
        ],
      }
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
    //           { action: 'nightVisionToggle', label: 'Toggle night vision' },
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
