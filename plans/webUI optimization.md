# web UI optimization
- no visual or functional changes. purely optimization.
- reduce amount of invalidation for unrelated session and socket updates, wherever possible. 
  - example: new log line invalidates more than just log panels, or maybe buttonbox count events invalidate every other panel too
- optimize anything and everything that updates on every rover sensor frame
  - ensure that things only get updated when they need to
  - rewrite rendering if needed, if it can be improved
  - example: the light bump bars, and the SVG top-down view.
  - sensors frames come at a high frequency, about 40hz. 
  - not acceptable to slow it down, responsivenes is important
- make sure that nothing is running in the background unless it needs to be
  - example: the neato card could still be running and updating its lidar viewer even when not in the VIP tab
## fixes along the way, along the route of optimizing
- audio forwarding happens within the card itself. this is okay, but it needs to continue working and not stop or restart when tabs are switched and the card is no longer onscreen