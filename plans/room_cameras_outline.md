# general idea
- add support for multiple room cameras through the server to the UI

## what needs to happen on the server:
- add support for a path of room cameras on mediamtx
  - /room/<camera_name>
  - CANNOT interfere with rover cameras (/<rover_name>)
- needs to use the same auth system as the rover cameras


## what needs to happen in the web UI
- users should be able to see all room cameras, even if not assigned to a rover
- automatically add a room camera player for each room camera