# ONVIF first, reolink specifics second PTZ camera integration

## what where who how
- adding support for a reolink PTZ camera
- ideally control everything over ONVIF
  - if needed for some of the special features, use https://github.com/verheesj/reolink-api
- VIP (verified user) feature only
- due to upload bandwidth limitations (ONLY UPLOAD TO USERS MATTERS HERE NOT INTERNAl NETWORK STUFF), only one person should be on the camera at a time. only one person at a time should view 
  - the ptz camera should have a queue and turns that are like 5 mintues long or so, so no one can hog it
  - if you are the camera operator, you are not on a rover. ever.
  - if you are a spectator, you can see the snapshots for it
    - local spectators should get full video like they already do now though
- the camera needs to be a replay source


## UI flow:
- whole UI should be very technical and utilitarian
  - use cardframe for everything
  - match global styling
- new card in VIP tab
  - shows whoevers on the camera
  - a very slow snapshot of the camera view
  - maybe some other stats
  - a big button to open the camera controller
- the fullscreen camera interface
  - the rest of the site needs to go away when this is open
  - desktop
    - takes over rover controls
      - movement controls pan and tilt
      - camera up / down controls zoom
      - headlight and laser buttons hopefully control spotlight and IR light or something
    - fullscreen inteface
    - right sidebar with info and controls info
  - mobile
    - uhhh idk
    - 