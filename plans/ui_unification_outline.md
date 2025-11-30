# general idea
- a bunch of small UI adjustments
- always keep styling consistent to the rest of the page

## everywhere
- add an audio stream status to the rover video panel, only show it if the rover has the separate audio stream
- make the room camera panels save their stack setting per instance of the panel in the web UI's settings storage system
- remove the status bar below room cameras
  - put it in the corner of the feed, like the other video panels
- make the styling of the room camera panels match everything else
- when the user list switches to turns, always show the plain user list, but below the turns info

## on the spectator page
- rover video panels
  - no more telemetry bar below each rover video
    - ovelay the tiny telemetry summary on the left side of the video, with the rest of the HUD elements
    - including the battery bar, make it vertical on the right side of the video
  - no more title bar above each rover video
  - the rover's name is already on the HUD
  - add current driver to the HUD
- sidebar
  - shrink the logs panel
  - add an actual rover list to the top of the sidebar