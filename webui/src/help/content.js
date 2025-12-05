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
          'Line up the rover to the dock, about a foot away, then:',
          { segments: ['Press the "Dock and Charge" button onscreen, or press ', { action: 'dockMacro' }, ' on your keyboard to start docking.'] },
          'Wait for the rover to confirm it is docked and charging before leaving it unattended.',
        ],
      },
    ],
    aside: [
      {
        type: 'keyboard',
        title: 'Keyboard controls',
        footnote: 'Per-browser; adjust in Settings → Keybindings.',
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
              { action: 'dockMacro', label: 'Dock macro' },
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
        ],
      },
      {
        type: 'gamepad',
        title: 'Gamepad / joystick',
        items: [
          'Gamepad controls are not mapped by default, this is because of how terribly inconsistent gamepad implementations are across browsers and devices.',
          'You can map gamepad controls in Settings → Controller.',
          'Use at your own risk, it may not be perfect depending on your setup.'
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
          'Look below the rover video. Use the joystick on the right to move the rover, and hold the buttons on the left to run the aux motors.'
        ],
      },
      {
        type: 'list',
        title: 'Docking the rover',
        items: [
          'Line up the rover to the dock, about a foot away, then:',
          { segments: ['Press the "Dock and Charge" button onscreen to start docking.'] },
          'Wait for the rover to confirm it is docked and charging before leaving it unattended.',
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
          'Use the joystick to the right of the video feed to move the rover, and hold the buttons on the left to run the aux motors.'
        ],
      },
      {
        type: 'list',
        title: 'Docking the rover',
        items: [
          'Line up the rover to the dock, about a foot away, then:',
          { segments: ['Press the "Dock and Charge" or the "Dock" button onscreen to start docking.'] },
          'Wait for the rover to confirm it is docked and charging before leaving it unattended.',
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
